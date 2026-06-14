use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const COMPLETION_DELAY: Duration = Duration::from_secs(5);
const TRANSCRIPT_EVENT: &str = "terax:claude-transcript";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEvent {
    pub kind: &'static str,
    pub project_dir: String,
}

struct FileState {
    offset: u64,
    running_tool_ids: HashSet<String>,
    pending_completion: Option<Instant>,
    project_dir: String,
}

fn projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

fn has_permission_keywords(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("allow")
        || lower.contains("approve")
        || lower.contains("permission")
        || lower.contains("authorize")
        || lower.contains("do you want to")
        || lower.contains("ask-confirmation")
}

fn process_entries(entries: Vec<Value>, state: &mut FileState) -> Vec<&'static str> {
    let mut events: Vec<&'static str> = Vec::new();

    for entry in entries {
        let entry_type = entry.get("type").and_then(Value::as_str).unwrap_or("");

        if entry_type == "assistant" {
            if let Some(content) = entry.pointer("/message/content").and_then(Value::as_array) {
                let mut has_tool_use = false;
                let mut has_text = false;

                for block in content {
                    match block.get("type").and_then(Value::as_str) {
                        Some("tool_use") => {
                            if let Some(id) = block.get("id").and_then(Value::as_str) {
                                if block.get("name").is_some() {
                                    state.running_tool_ids.insert(id.to_string());
                                    has_tool_use = true;
                                    state.pending_completion = None;
                                }
                            }
                        }
                        Some("text")
                            if block.get("text").and_then(Value::as_str).is_some() =>
                        {
                            has_text = true;
                        }
                        _ => {}
                    }
                }

                if has_text && !has_tool_use && state.running_tool_ids.is_empty() {
                    state.pending_completion = Some(Instant::now());
                }
            }
        }

        if entry_type == "user" {
            let content = entry.pointer("/message/content");

            if let Some(s) = content.and_then(Value::as_str) {
                if has_permission_keywords(s) {
                    state.pending_completion = None;
                    events.push("attention");
                    continue;
                }
            }

            if let Some(arr) = content.and_then(Value::as_array) {
                'blocks: for block in arr {
                    match block.get("type").and_then(Value::as_str) {
                        Some("tool_result") => {
                            if let Some(tool_id) =
                                block.get("tool_use_id").and_then(Value::as_str)
                            {
                                state.running_tool_ids.remove(tool_id);
                            }
                            if block.get("is_error").and_then(Value::as_bool) == Some(true) {
                                let text =
                                    block.get("content").and_then(Value::as_str).unwrap_or("");
                                if has_permission_keywords(text) {
                                    state.pending_completion = None;
                                    events.push("attention");
                                    break 'blocks;
                                }
                            }
                        }
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                if has_permission_keywords(text) {
                                    state.pending_completion = None;
                                    events.push("attention");
                                    break 'blocks;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    events
}

fn scan_file(path: &PathBuf, state: &mut FileState) -> Vec<&'static str> {
    let Ok(meta) = std::fs::metadata(path) else {
        return vec![];
    };
    let current_size = meta.len();
    if current_size <= state.offset {
        return vec![];
    }

    let to_read = (current_size - state.offset) as usize;
    let mut buf = vec![0u8; to_read];

    let Ok(mut f) = std::fs::File::open(path) else {
        return vec![];
    };
    if f.seek(SeekFrom::Start(state.offset)).is_err() {
        return vec![];
    }
    if f.read_exact(&mut buf).is_err() {
        return vec![];
    }
    state.offset = current_size;

    let text = String::from_utf8_lossy(&buf);
    let entries: Vec<Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    if entries.is_empty() {
        return vec![];
    }

    process_entries(entries, state)
}

fn scan_once(states: &mut HashMap<PathBuf, FileState>, app: &AppHandle) {
    let Some(projects_dir) = projects_dir() else {
        return;
    };
    let Ok(project_entries) = std::fs::read_dir(&projects_dir) else {
        return;
    };

    for project_entry in project_entries.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let Some(dir_name) = project_path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let dir_name = dir_name.to_string();

        let Ok(jsonl_entries) = std::fs::read_dir(&project_path) else {
            continue;
        };

        for jsonl_entry in jsonl_entries.flatten() {
            let jsonl_path = jsonl_entry.path();
            if jsonl_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            let state = states.entry(jsonl_path.clone()).or_insert_with(|| FileState {
                offset: 0,
                running_tool_ids: HashSet::new(),
                pending_completion: None,
                project_dir: dir_name.clone(),
            });

            // Initialize offset to current size on first encounter to avoid replaying history.
            if state.offset == 0 {
                if let Ok(meta) = std::fs::metadata(&jsonl_path) {
                    state.offset = meta.len();
                }
                continue;
            }

            let events = scan_file(&jsonl_path, state);
            for kind in events {
                let _ = app.emit(
                    TRANSCRIPT_EVENT,
                    TranscriptEvent { kind, project_dir: state.project_dir.clone() },
                );
            }
        }
    }

    // Emit pending completions whose delay has elapsed.
    for state in states.values_mut() {
        if let Some(scheduled) = state.pending_completion {
            if scheduled.elapsed() >= COMPLETION_DELAY && state.running_tool_ids.is_empty() {
                state.pending_completion = None;
                let _ = app.emit(
                    TRANSCRIPT_EVENT,
                    TranscriptEvent { kind: "finished", project_dir: state.project_dir.clone() },
                );
            }
        }
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut states: HashMap<PathBuf, FileState> = HashMap::new();
        loop {
            scan_once(&mut states, &app);
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}
