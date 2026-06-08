use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Tracks in-flight local copy operations so they can be cancelled.
/// Keyed by the frontend-supplied opaque transfer id.
#[derive(Default)]
pub struct CopyState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CopyState {
    fn register(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .unwrap()
            .insert(transfer_id.to_string(), flag.clone());
        flag
    }

    fn unregister(&self, transfer_id: &str) {
        self.cancels.lock().unwrap().remove(transfer_id);
    }

    fn cancel(&self, transfer_id: &str) -> bool {
        if let Some(flag) = self.cancels.lock().unwrap().get(transfer_id) {
            flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCopyProgress {
    pub transfer_id: String,
    pub bytes_done: u64,
    pub total_bytes: u64,
    /// Path of the file currently being copied, relative to the copy root.
    pub current_file: String,
}

const COPY_CHUNK: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// Copies one file, streaming chunks and emitting throttled progress.
/// `rel` is the file's display path relative to the copy root. `done_offset`
/// is the bytes already counted from prior files in a recursive copy; `total`
/// is the grand total for the whole operation.
#[allow(clippy::too_many_arguments)]
fn copy_file_streamed(
    src: &Path,
    dst: &Path,
    rel: &str,
    transfer_id: &str,
    cancel: &AtomicBool,
    on_progress: &Channel<FsCopyProgress>,
    done_offset: u64,
    total: u64,
) -> Result<u64, String> {
    let mut reader = std::fs::File::open(src).map_err(|e| {
        format!("open source {}: {e}", src.display())
    })?;
    let mut writer = std::fs::File::create(dst).map_err(|e| {
        format!("create dest {}: {e}", dst.display())
    })?;

    let mut buf = vec![0u8; COPY_CHUNK];
    let mut file_done: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        if cancel.load(Ordering::SeqCst) {
            drop(writer);
            let _ = std::fs::remove_file(dst);
            return Err("cancelled".to_string());
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", src.display()))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("write {}: {e}", dst.display()))?;
        file_done += n as u64;

        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            last_emit = Instant::now();
            let _ = on_progress.send(FsCopyProgress {
                transfer_id: transfer_id.to_string(),
                bytes_done: done_offset + file_done,
                total_bytes: total,
                current_file: rel.to_string(),
            });
        }
    }

    writer
        .flush()
        .map_err(|e| format!("flush {}: {e}", dst.display()))?;

    Ok(file_done)
}

/// Walks a directory tree, returning (absolute_path, relative_path, size) for
/// every regular file beneath `root`. Directories are created lazily by the
/// caller as files are copied.
fn collect_files(root: &Path, total: &mut u64, out: &mut Vec<(std::path::PathBuf, String)>) -> Result<(), String> {
    fn walk(
        base: &Path,
        dir: &Path,
        total: &mut u64,
        out: &mut Vec<(std::path::PathBuf, String)>,
    ) -> Result<(), String> {
        let read = std::fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
        for entry in read.filter_map(Result::ok) {
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path)
                .map_err(|e| format!("stat {}: {e}", path.display()))?;
            if meta.is_dir() {
                walk(base, &path, total, out)?;
            } else if meta.is_file() {
                *total += meta.len();
                let rel = path
                    .strip_prefix(base)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| path.to_string_lossy().into_owned());
                out.push((path, rel));
            }
        }
        Ok(())
    }
    walk(root, root, total, out)
}

/// Copies a single file from `src` to `dst`, streaming with progress.
/// Refuses to overwrite an existing destination (skip-by-default policy).
#[tauri::command]
pub async fn fs_copy(
    state: tauri::State<'_, CopyState>,
    transfer_id: String,
    src: String,
    dst: String,
    overwrite: bool,
    workspace: Option<WorkspaceEnv>,
    on_progress: Channel<FsCopyProgress>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let src_p = resolve_path(&src, &workspace);
    let dst_p = resolve_path(&dst, &workspace);

    if !src_p.is_file() {
        return Err(format!("not a file: {}", src_p.display()));
    }
    if dst_p.exists() && !overwrite {
        return Err("destination exists".to_string());
    }
    if let Some(parent) = dst_p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let total = std::fs::metadata(&src_p).map(|m| m.len()).unwrap_or(0);
    let name = src_p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cancel = state.register(&transfer_id);

    let result = tauri::async_runtime::spawn_blocking(move || {
        copy_file_streamed(
            &src_p,
            &dst_p,
            &name,
            &transfer_id,
            &cancel,
            &on_progress,
            0,
            total,
        )
        .map(|_| {
            let _ = on_progress.send(FsCopyProgress {
                transfer_id: transfer_id.clone(),
                bytes_done: total,
                total_bytes: total,
                current_file: name.clone(),
            });
            transfer_id
        })
    })
    .await
    .map_err(|e| format!("copy task join error: {e}"));

    let unregister_id = match &result {
        Ok(Ok(id)) => id.clone(),
        _ => String::new(),
    };
    if !unregister_id.is_empty() {
        state.unregister(&unregister_id);
    }

    result.and_then(|r| r.map(|_| ()))
}

/// Recursively copies a directory tree from `src` into `dst`, streaming
/// aggregate progress across all files. Refuses to overwrite when the
/// destination root already exists unless `overwrite` is set.
#[tauri::command]
pub async fn fs_copy_recursive(
    state: tauri::State<'_, CopyState>,
    transfer_id: String,
    src: String,
    dst: String,
    overwrite: bool,
    workspace: Option<WorkspaceEnv>,
    on_progress: Channel<FsCopyProgress>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let src_p = resolve_path(&src, &workspace);
    let dst_p = resolve_path(&dst, &workspace);

    if !src_p.is_dir() {
        return Err(format!("not a directory: {}", src_p.display()));
    }
    if dst_p.exists() && !overwrite {
        return Err("destination exists".to_string());
    }

    let cancel = state.register(&transfer_id);
    let tid = transfer_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut total: u64 = 0;
        let mut files = Vec::new();
        collect_files(&src_p, &mut total, &mut files)?;

        std::fs::create_dir_all(&dst_p)
            .map_err(|e| format!("create dest dir {}: {e}", dst_p.display()))?;

        let mut done: u64 = 0;
        for (abs, rel) in files {
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            let target = dst_p.join(&rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create dir {}: {e}", parent.display()))?;
            }
            let copied = copy_file_streamed(
                &abs, &target, &rel, &transfer_id, &cancel, &on_progress, done, total,
            )?;
            done += copied;
        }

        let _ = on_progress.send(FsCopyProgress {
            transfer_id: transfer_id.clone(),
            bytes_done: total,
            total_bytes: total,
            current_file: String::new(),
        });
        Ok(())
    })
    .await
    .map_err(|e| format!("copy task join error: {e}"));

    state.unregister(&tid);
    result.and_then(|r| r)
}

/// Signals an in-flight `fs_copy` / `fs_copy_recursive` to abort. No-op if the
/// transfer already finished or never existed.
#[tauri::command]
pub fn fs_copy_cancel(state: tauri::State<'_, CopyState>, transfer_id: String) -> Result<(), String> {
    state.cancel(&transfer_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::Channel;

    fn null_channel() -> Channel<FsCopyProgress> {
        Channel::new(|_| Ok(()))
    }

    #[test]
    fn copy_file_streams_bytes_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.bin");
        let dst = dir.path().join("dst.bin");
        let payload = vec![7u8; 200_000];
        std::fs::write(&src, &payload).unwrap();

        let state = CopyState::default();
        let cancel = state.register("t1");
        copy_file_streamed(&src, &dst, "src.bin", "t1", &cancel, &null_channel(), 0, payload.len() as u64)
            .expect("copy");
        state.unregister("t1");
        assert_eq!(std::fs::read(&dst).unwrap(), payload);
    }

    #[test]
    fn collect_files_walks_tree_and_sums_size() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tree");
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("x.txt"), b"hello").unwrap();
        std::fs::write(root.join("a/y.txt"), b"world!").unwrap();
        std::fs::write(root.join("a/b/z.txt"), b"!").unwrap();

        let mut total = 0u64;
        let mut out = Vec::new();
        collect_files(&root, &mut total, &mut out).unwrap();

        assert_eq!(out.len(), 3);
        assert_eq!(total, 5 + 6 + 1);
        let rels: Vec<&str> = out.iter().map(|(_, r)| r.as_str()).collect();
        assert!(rels.contains(&"x.txt"));
        assert!(rels.contains(&"a/y.txt"));
        assert!(rels.contains(&"a/b/z.txt"));
    }

    #[test]
    fn cancel_flag_aborts_and_cleans_partial() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.bin");
        let dst = dir.path().join("dst.bin");
        std::fs::write(&src, vec![1u8; 500_000]).unwrap();

        let state = CopyState::default();
        let cancel = state.register("t2");
        // Pre-cancel so the first chunk check trips immediately.
        state.cancel("t2");
        let err = copy_file_streamed(
            &src, &dst, "src.bin", "t2", &cancel, &null_channel(), 0, 500_000,
        )
        .unwrap_err();
        state.unregister("t2");
        assert_eq!(err, "cancelled");
        assert!(!dst.exists(), "partial dest must be removed on cancel");
    }
}


