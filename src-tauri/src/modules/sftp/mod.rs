use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use russh::Disconnect;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::modules::ssh;

/// Format an SFTP error into a clean, user-friendly message.
fn format_sftp_error(e: russh_sftp::client::error::Error) -> String {
    let s = e.to_string();
    // russh-sftp Status errors format as "{code}: {message}" where code and
    // message can be identical (e.g. "Permission denied: Permission denied").
    // Deduplicate when the prefix matches.
    if let Some((code, msg)) = s.split_once(": ") {
        if code.trim() == msg.trim() {
            return code.trim().to_string();
        }
    }
    s
}

pub struct SftpState {
    sessions: Arc<RwLock<HashMap<u32, SftpSessionHandle>>>,
    next_id: AtomicU32,
    /// Cancellation tokens for in-flight transfers, keyed by frontend transfer id.
    transfers: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Default for SftpState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
            transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

struct SftpSessionHandle {
    sftp: Arc<SftpSession>,
    _handle: russh::client::Handle<ssh::ClientHandler>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpenResult {
    id: u32,
    home: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirEntry {
    name: String,
    kind: String,
    size: u64,
    mtime: u64,
    mode: Option<u32>,
}

#[tauri::command]
pub async fn sftp_open(
    state: tauri::State<'_, SftpState>,
    opts: ssh::SshOpenOptions,
) -> Result<SftpOpenResult, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let handle = ssh::connect_and_auth(&opts).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {e}"))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("SFTP subsystem request failed: {e}"))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP session init failed: {e}"))?;

    let home = sftp
        .canonicalize(".")
        .await
        .map_err(|e| format!("Failed to resolve home directory: {e}"))?;

    let session_handle = SftpSessionHandle {
        sftp: Arc::new(sftp),
        _handle: handle,
    };

    state.sessions.write().unwrap().insert(id, session_handle);

    Ok(SftpOpenResult { id, home })
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<Vec<SftpDirEntry>, String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    let read_dir = sftp
        .read_dir(&path)
        .await
        .map_err(format_sftp_error)?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }

        let meta = entry.metadata();
        let kind = if entry.file_type().is_dir() {
            "dir"
        } else if entry.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };

        entries.push(SftpDirEntry {
            name,
            kind: kind.to_string(),
            size: meta.size.unwrap_or(0),
            mtime: meta.mtime.map(|s| s as u64 * 1000).unwrap_or(0),
            mode: meta.permissions,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn sftp_close(
    state: tauri::State<'_, SftpState>,
    id: u32,
) -> Result<(), String> {
    let handle = state
        .sessions
        .write()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| format!("no sftp session {id}"))?;

    let _ = handle.sftp.close().await;
    let _ = handle
        ._handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    Ok(())
}

/// Recursively delete a directory and all its contents via SFTP.
/// `remove_dir` only works on empty directories, so we walk the tree first.
async fn sftp_remove_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let read_dir = sftp
        .read_dir(path)
        .await
        .map_err(format_sftp_error)?;

    for entry in read_dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{path}/{name}");
        if entry.file_type().is_dir() {
            Box::pin(sftp_remove_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await.map_err(format_sftp_error)?;
        }
    }

    sftp.remove_dir(path).await.map_err(format_sftp_error)
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    sftp.create_dir(&path).await.map_err(format_sftp_error)
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SftpState>,
    id: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    sftp.rename(&from, &to).await.map_err(format_sftp_error)
}

#[tauri::command]
pub async fn sftp_remove(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    if is_dir {
        sftp_remove_recursive(&sftp, &path).await
    } else {
        sftp.remove_file(&path).await.map_err(format_sftp_error)
    }
}

#[tauri::command]
pub async fn sftp_chmod(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(mode);
    sftp.set_metadata(&path, attrs).await.map_err(format_sftp_error)
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SftpReadResult {
    Text { content: String, size: u64 },
    Binary { size: u64 },
}

const SFTP_MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const SFTP_BINARY_SNIFF_BYTES: usize = 8192;

#[tauri::command]
pub async fn sftp_read_file(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<SftpReadResult, String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    let bytes = sftp.read(&path).await.map_err(format_sftp_error)?;
    let size = bytes.len() as u64;

    if size > SFTP_MAX_READ_BYTES {
        return Ok(SftpReadResult::Binary { size });
    }

    let sniff_len = bytes.len().min(SFTP_BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(SftpReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(SftpReadResult::Text { content, size }),
        Err(_) => Ok(SftpReadResult::Binary { size }),
    }
}

#[tauri::command]
pub async fn sftp_write_file(
    state: tauri::State<'_, SftpState>,
    id: u32,
    path: String,
    content: String,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    sftp.write(&path, content.as_bytes())
        .await
        .map_err(format_sftp_error)
}

/// Downloads a remote file and saves it to a local path (raw bytes).
/// Used for non-text files (images, PDFs, etc.) that need to be opened
/// with the OS default application.
#[tauri::command]
pub async fn sftp_download_file(
    state: tauri::State<'_, SftpState>,
    id: u32,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp = {
        let sessions = state.sessions.read().unwrap();
        let handle = sessions
            .get(&id)
            .ok_or_else(|| format!("no sftp session {id}"))?;
        handle.sftp.clone()
    };

    let bytes = sftp
        .read(&remote_path)
        .await
        .map_err(format_sftp_error)?;

    // Ensure parent directory exists.
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&local_path, &bytes).map_err(|e| {
        log::warn!("sftp_download_file write failed: {e}");
        e.to_string()
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferProgress {
    pub transfer_id: String,
    pub bytes_done: u64,
    pub total_bytes: u64,
    /// Path of the file currently moving, relative to the transfer root.
    pub current_file: String,
}

const XFER_CHUNK: usize = 64 * 1024;
const XFER_PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// Grabs the SFTP session handle for `id`, cloning the Arc so the lock is held
/// only briefly.
fn session_for(state: &SftpState, id: u32) -> Result<Arc<SftpSession>, String> {
    let sessions = state.sessions.read().unwrap();
    let handle = sessions
        .get(&id)
        .ok_or_else(|| format!("no sftp session {id}"))?;
    Ok(handle.sftp.clone())
}

impl SftpState {
    fn register_transfer(&self, transfer_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.transfers
            .lock()
            .unwrap()
            .insert(transfer_id.to_string(), token.clone());
        token
    }

    fn unregister_transfer(&self, transfer_id: &str) {
        self.transfers.lock().unwrap().remove(transfer_id);
    }
}

/// Signals an in-flight SFTP transfer to abort. No-op if it already finished.
#[tauri::command]
pub fn sftp_cancel(state: tauri::State<'_, SftpState>, transfer_id: String) -> Result<(), String> {
    if let Some(token) = state.transfers.lock().unwrap().get(&transfer_id) {
        token.cancel();
    }
    Ok(())
}

/// Streams one local file up to the remote, emitting throttled progress.
/// `done_offset`/`total` let recursive callers report aggregate progress.
#[allow(clippy::too_many_arguments)]
async fn upload_one(
    sftp: &SftpSession,
    local_path: &std::path::Path,
    remote_path: &str,
    rel: &str,
    transfer_id: &str,
    token: &CancellationToken,
    on_progress: &Channel<SftpTransferProgress>,
    done_offset: u64,
    total: u64,
) -> Result<u64, String> {
    let mut local = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("open {}: {e}", local_path.display()))?;

    let mut remote = sftp
        .open_with_flags(
            remote_path.to_string(),
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(format_sftp_error)?;

    let mut buf = vec![0u8; XFER_CHUNK];
    let mut file_done: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        if token.is_cancelled() {
            let _ = remote.shutdown().await;
            let _ = sftp.remove_file(remote_path.to_string()).await;
            return Err("cancelled".to_string());
        }
        let n = local
            .read(&mut buf)
            .await
            .map_err(|e| format!("read {}: {e}", local_path.display()))?;
        if n == 0 {
            break;
        }
        remote
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("write {remote_path}: {e}"))?;
        file_done += n as u64;

        if last_emit.elapsed() >= XFER_PROGRESS_INTERVAL {
            last_emit = Instant::now();
            let _ = on_progress.send(SftpTransferProgress {
                transfer_id: transfer_id.to_string(),
                bytes_done: done_offset + file_done,
                total_bytes: total,
                current_file: rel.to_string(),
            });
        }
    }

    remote.shutdown().await.map_err(|e| format!("close {remote_path}: {e}"))?;
    Ok(file_done)
}

/// Streams one remote file down to a local path, emitting throttled progress.
#[allow(clippy::too_many_arguments)]
async fn download_one(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &std::path::Path,
    rel: &str,
    transfer_id: &str,
    token: &CancellationToken,
    on_progress: &Channel<SftpTransferProgress>,
    done_offset: u64,
    total: u64,
) -> Result<u64, String> {
    if let Some(parent) = local_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    let mut remote = sftp
        .open_with_flags(remote_path.to_string(), OpenFlags::READ)
        .await
        .map_err(format_sftp_error)?;
    let mut local = tokio::fs::File::create(local_path)
        .await
        .map_err(|e| format!("create {}: {e}", local_path.display()))?;

    let mut buf = vec![0u8; XFER_CHUNK];
    let mut file_done: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        if token.is_cancelled() {
            drop(local);
            let _ = tokio::fs::remove_file(local_path).await;
            return Err("cancelled".to_string());
        }
        let n = remote
            .read(&mut buf)
            .await
            .map_err(|e| format!("read {remote_path}: {e}"))?;
        if n == 0 {
            break;
        }
        local
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("write {}: {e}", local_path.display()))?;
        file_done += n as u64;

        if last_emit.elapsed() >= XFER_PROGRESS_INTERVAL {
            last_emit = Instant::now();
            let _ = on_progress.send(SftpTransferProgress {
                transfer_id: transfer_id.to_string(),
                bytes_done: done_offset + file_done,
                total_bytes: total,
                current_file: rel.to_string(),
            });
        }
    }

    local.flush().await.map_err(|e| format!("flush {}: {e}", local_path.display()))?;
    Ok(file_done)
}

/// Uploads a single local file to the remote. Refuses to overwrite unless
/// `overwrite` is set (skip-by-default policy).
#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, SftpState>,
    id: u32,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    overwrite: bool,
    on_progress: Channel<SftpTransferProgress>,
) -> Result<(), String> {
    let sftp = session_for(&state, id)?;
    let local = std::path::PathBuf::from(&local_path);
    if !local.is_file() {
        return Err(format!("not a file: {local_path}"));
    }
    if !overwrite && sftp.try_exists(remote_path.clone()).await.unwrap_or(false) {
        return Err("destination exists".to_string());
    }

    let total = tokio::fs::metadata(&local).await.map(|m| m.len()).unwrap_or(0);
    let name = local
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let token = state.register_transfer(&transfer_id);

    let result = upload_one(
        &sftp, &local, &remote_path, &name, &transfer_id, &token, &on_progress, 0, total,
    )
    .await;
    state.unregister_transfer(&transfer_id);

    result.map(|_| {
        let _ = on_progress.send(SftpTransferProgress {
            transfer_id,
            bytes_done: total,
            total_bytes: total,
            current_file: name,
        });
    })
}

/// Downloads a single remote file to a local path. Refuses to overwrite unless
/// `overwrite` is set.
#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, SftpState>,
    id: u32,
    transfer_id: String,
    remote_path: String,
    local_path: String,
    overwrite: bool,
    on_progress: Channel<SftpTransferProgress>,
) -> Result<(), String> {
    let sftp = session_for(&state, id)?;
    let local = std::path::PathBuf::from(&local_path);
    if !overwrite && local.exists() {
        return Err("destination exists".to_string());
    }

    let total = sftp
        .metadata(remote_path.clone())
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);
    let name = remote_path.rsplit('/').next().unwrap_or("").to_string();
    let token = state.register_transfer(&transfer_id);

    let result = download_one(
        &sftp, &remote_path, &local, &name, &transfer_id, &token, &on_progress, 0, total,
    )
    .await;
    state.unregister_transfer(&transfer_id);

    result.map(|_| {
        let _ = on_progress.send(SftpTransferProgress {
            transfer_id,
            bytes_done: total,
            total_bytes: total,
            current_file: name,
        });
    })
}

/// Walks a remote directory tree, collecting (remote_path, rel_path, size) for
/// every regular file beneath `root`.
async fn collect_remote(
    sftp: &SftpSession,
    root: &str,
    total: &mut u64,
    out: &mut Vec<(String, String)>,
) -> Result<(), String> {
    let mut stack = vec![root.to_string()];
    while let Some(dir) = stack.pop() {
        let read = sftp.read_dir(dir.clone()).await.map_err(format_sftp_error)?;
        for entry in read {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = format!("{dir}/{name}");
            if entry.file_type().is_dir() {
                stack.push(child);
            } else {
                *total += entry.metadata().size.unwrap_or(0);
                let rel = child.strip_prefix(root).unwrap_or(&child).trim_start_matches('/').to_string();
                out.push((child, rel));
            }
        }
    }
    Ok(())
}

/// Walks a local directory tree, collecting (abs_path, rel_path) for every file.
fn collect_local(
    root: &std::path::Path,
    total: &mut u64,
    out: &mut Vec<(std::path::PathBuf, String)>,
) -> Result<(), String> {
    let read = std::fs::read_dir(root).map_err(|e| format!("read_dir {}: {e}", root.display()))?;
    for entry in read.filter_map(Result::ok) {
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("stat {}: {e}", path.display()))?;
        if meta.is_dir() {
            collect_local(&path, total, out)?;
        } else if meta.is_file() {
            *total += meta.len();
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string_lossy().into_owned());
            out.push((path, rel));
        }
    }
    Ok(())
}

/// Recursively uploads a local directory tree to the remote.
#[tauri::command]
pub async fn sftp_upload_recursive(
    state: tauri::State<'_, SftpState>,
    id: u32,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    overwrite: bool,
    on_progress: Channel<SftpTransferProgress>,
) -> Result<(), String> {
    let sftp = session_for(&state, id)?;
    let root = std::path::PathBuf::from(&local_path);
    if !root.is_dir() {
        return Err(format!("not a directory: {local_path}"));
    }
    if !overwrite && sftp.try_exists(remote_path.clone()).await.unwrap_or(false) {
        return Err("destination exists".to_string());
    }

    let mut total: u64 = 0;
    let mut files = Vec::new();
    collect_local(&root, &mut total, &mut files)?;

    let _ = sftp.create_dir(remote_path.clone()).await;
    let token = state.register_transfer(&transfer_id);

    let mut done: u64 = 0;
    let mut result = Ok(());
    for (abs, rel) in &files {
        if token.is_cancelled() {
            result = Err("cancelled".to_string());
            break;
        }
        let dest = format!("{remote_path}/{rel}");
        if let Some(parent) = std::path::Path::new(rel).parent() {
            if !parent.as_os_str().is_empty() {
                let _ = sftp.create_dir(format!("{remote_path}/{}", parent.to_string_lossy())).await;
            }
        }
        match upload_one(&sftp, abs, &dest, rel, &transfer_id, &token, &on_progress, done, total).await {
            Ok(n) => done += n,
            Err(e) => {
                result = Err(e);
                break;
            }
        }
    }
    state.unregister_transfer(&transfer_id);
    result
}

/// Recursively downloads a remote directory tree to a local path.
#[tauri::command]
pub async fn sftp_download_recursive(
    state: tauri::State<'_, SftpState>,
    id: u32,
    transfer_id: String,
    remote_path: String,
    local_path: String,
    overwrite: bool,
    on_progress: Channel<SftpTransferProgress>,
) -> Result<(), String> {
    let sftp = session_for(&state, id)?;
    let root = std::path::PathBuf::from(&local_path);
    if !overwrite && root.exists() {
        return Err("destination exists".to_string());
    }

    let mut total: u64 = 0;
    let mut files = Vec::new();
    collect_remote(&sftp, &remote_path, &mut total, &mut files).await?;

    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("create {}: {e}", root.display()))?;
    let token = state.register_transfer(&transfer_id);

    let mut done: u64 = 0;
    let mut result = Ok(());
    for (remote_file, rel) in &files {
        if token.is_cancelled() {
            result = Err("cancelled".to_string());
            break;
        }
        let dest = root.join(rel);
        match download_one(&sftp, remote_file, &dest, rel, &transfer_id, &token, &on_progress, done, total).await {
            Ok(n) => done += n,
            Err(e) => {
                result = Err(e);
                break;
            }
        }
    }
    state.unregister_transfer(&transfer_id);
    result
}
