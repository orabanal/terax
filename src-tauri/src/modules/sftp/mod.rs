use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use russh::Disconnect;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;
use serde::Serialize;

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
}

impl Default for SftpState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
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
