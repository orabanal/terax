//! OpenCode notification bridge.
//!
//! Terax ships a tiny OpenCode plugin (`opencode_notify_plugin.js`, embedded
//! below) that appends one JSON object per line to
//! `~/.terax-opencode-events.jsonl` on `session.idle` / `session.error` /
//! `permission.asked`. This module installs that plugin locally, exposes its
//! source for remote (SSH) installs, and tails the local events file,
//! forwarding entries as `terax:opencode-signal` — the same UX as the Claude
//! Code transcript watcher. Remote hosts are tailed over an SSH exec channel
//! (see `ssh_tail_*` in `super::ssh`).

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const OPENCODE_EVENT: &str = "terax:opencode-signal";

pub const PLUGIN_VERSION: u32 = 1;
pub const PLUGIN_FILENAME: &str = "terax-notify.js";
pub const EVENTS_FILENAME: &str = ".terax-opencode-events.jsonl";

const PLUGIN_TEMPLATE: &str = include_str!("opencode_notify_plugin.js");

/// Plugin source with version + events-file placeholders resolved. Single
/// source of truth for local installs and (via
/// `opencode_notify_plugin_source`) remote installs over SSH.
pub fn plugin_source() -> String {
    PLUGIN_TEMPLATE
        .replace("{{PLUGIN_VERSION}}", &PLUGIN_VERSION.to_string())
        .replace("{{EVENTS_FILE}}", EVENTS_FILENAME)
}

fn plugin_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".config")
            .join("opencode")
            .join("plugins")
            .join(PLUGIN_FILENAME)
    })
}

pub fn events_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(EVENTS_FILENAME))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotifyStatus {
    pub installed: bool,
    pub version: u32,
    pub path: Option<String>,
}

fn read_status() -> NotifyStatus {
    let path = plugin_path();
    let mut installed = false;
    let mut version = 0;
    if let Some(p) = &path {
        if let Ok(content) = std::fs::read_to_string(p) {
            for line in content.lines() {
                let line = line.trim().trim_start_matches("/").trim();
                if let Some(rest) = line.strip_prefix("terax-notify v") {
                    if let Ok(v) = rest.trim().parse::<u32>() {
                        version = v;
                        installed = v == PLUGIN_VERSION;
                    }
                    break;
                }
            }
        }
    }
    NotifyStatus {
        installed,
        version,
        path: path.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn opencode_notify_plugin_source() -> String {
    plugin_source()
}

#[tauri::command]
pub fn opencode_notify_local_status() -> NotifyStatus {
    read_status()
}

#[tauri::command]
pub fn opencode_notify_install_local() -> Result<NotifyStatus, String> {
    let path = plugin_path().ok_or_else(|| "home directory not found".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create plugins dir: {e}"))?;
    }
    std::fs::write(&path, plugin_source())
        .map_err(|e| format!("failed to write plugin: {e}"))?;
    Ok(read_status())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeSignal {
    pub kind: String,
    pub session_id: Option<String>,
    pub directory: Option<String>,
    pub project: Option<String>,
    pub detail: Option<String>,
    pub origin: &'static str,
}

fn parse_line(line: &str) -> Option<OpencodeSignal> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("v").and_then(serde_json::Value::as_u64) != Some(1) {
        return None;
    }
    if v.get("agent").and_then(serde_json::Value::as_str) != Some("opencode") {
        return None;
    }
    let kind = v.get("kind").and_then(serde_json::Value::as_str)?;
    if !matches!(kind, "finished" | "attention" | "error") {
        return None;
    }
    let str_field = |k: &str| {
        v.get(k)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    Some(OpencodeSignal {
        kind: kind.to_string(),
        session_id: str_field("sessionId"),
        directory: str_field("directory"),
        project: str_field("project"),
        detail: str_field("detail"),
        origin: "local",
    })
}

fn scan_once(states: &mut HashMap<PathBuf, u64>, app: &AppHandle) {
    let Some(path) = events_path() else {
        return;
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return;
    };
    let size = meta.len();
    let offset = states.entry(path.clone()).or_insert_with(|| {
        // Start at EOF so pre-existing lines never replay.
        size
    });
    if size <= *offset {
        // File truncated/rotated: re-anchor at EOF.
        if size < *offset {
            *offset = size;
        }
        return;
    }
    let to_read = (size - *offset) as usize;
    let mut buf = vec![0u8; to_read];
    let Ok(mut f) = std::fs::File::open(&path) else {
        return;
    };
    if f.seek(SeekFrom::Start(*offset)).is_err() {
        return;
    }
    if f.read_exact(&mut buf).is_err() {
        return;
    }
    *offset = size;
    for line in String::from_utf8_lossy(&buf).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(sig) = parse_line(line) {
            let _ = app.emit(OPENCODE_EVENT, sig);
        }
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut states: HashMap<PathBuf, u64> = HashMap::new();
        loop {
            scan_once(&mut states, &app);
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}
