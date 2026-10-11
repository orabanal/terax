//! SSH-side Claude Code activity tracking.
//!
//! Port of the frontend `PtyClaudeTracker`: a visual-marker state machine
//! over the PTY byte stream (tool marker ⏺, spinner glyphs, permission
//! keywords). Running it here, over the already-coalesced stream in
//! `run_ssh_loop`, means the frontend does zero per-chunk work (no decode,
//! no regexes on the UI thread) and only receives transition events via
//! `terax:ssh-agent-state`.
//!
//! Parity notes vs the JS original:
//! - UTF-8 decoding is lossy per packet on both sides (JS `TextDecoder`
//!   without `stream:true` also resets per chunk).
//! - The 300-unit text bound counts UTF-16 code units like JS `length`;
//!   truncation never splits a surrogate pair (strictly safer).
//! - Lone `ESC` before a non-opener byte is emitted literally on both.
//! - A bare ESC *inside* an OSC payload aborts the OSC on both; the exact
//!   resynchronization on such garbage input may differ by a byte or two,
//!   which is unobservable in real terminal streams.

use std::time::Duration;
use tokio::time::Instant;

pub const INACTIVITY_MS: u64 = 10_000;
pub const PERMISSION_MS: u64 = 15_000;
/// JS `recentText` bound (UTF-16 code units).
const TEXT_BUFFER_MAX_UNITS: usize = 300;

// Claude Code's tool-separator marker rendered in the terminal.
const TOOL_MARKER: char = '⏺';

// Spinner chars Claude Code uses while processing.
const SPINNERS: &[char] = &[
    '✢', '✶', '◆', '●', '○', '◐', '◑', '◒', '◓', '◎', '◉', '⦿', '⦾', '⊙', '⊚',
    '⊛', '⊜', '⊝',
];

const PERMISSION_KEYWORDS: &[&str] = &[
    "allow",
    "approve",
    "permission",
    "authorize",
    "do you want to",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClaudeState {
    Idle,
    Active,
    PermissionWait,
}

#[derive(Debug, Clone)]
pub struct StateChange {
    pub state: ClaudeState,
    pub previous: ClaudeState,
    pub context: Option<String>,
}

/// Payload of the `terax:ssh-agent-state` event.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAgentState {
    pub ssh_id: u32,
    pub state: ClaudeState,
    pub previous_state: ClaudeState,
    pub context: Option<String>,
}

fn is_single_escape_byte(b: u8) -> bool {
    // ESC [@-Z\-_] — single-character escape (includes `\\` for ST).
    matches!(b, 0x40..=0x5A | 0x5C..=0x5F)
}

fn is_csi_param(b: u8) -> bool {
    (0x30..=0x3F).contains(&b)
}

fn is_csi_intermediate(b: u8) -> bool {
    (0x20..=0x2F).contains(&b)
}

fn is_csi_final(b: u8) -> bool {
    (0x40..=0x7E).contains(&b)
}

fn is_stripped_control(c: char) -> bool {
    // Mirrors CTRL_RE ranges; keeps \t and \n.
    matches!(c, '\0'..='\u{8}' | '\u{b}'..='\u{1f}' | '\u{7f}')
}

/// Split `input` (already prefixed with any pending tail) into clean text
/// plus the new incomplete-tail to buffer for the next chunk.
fn split_escapes(input: &str) -> (String, String) {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b != 0x1b {
            // ASCII fast path; boundaries hold for multi-byte below.
            if b < 0x80 {
                let c = b as char;
                if !is_stripped_control(c) {
                    out.push(c);
                }
                i += 1;
                continue;
            }
            // SAFETY: `i` always lands on a char boundary (0, or just past
            // ASCII escapes / whole chars consumed below).
            let c = input[i..].chars().next().unwrap_or('\u{fffd}');
            if !is_stripped_control(c) {
                out.push(c);
            }
            i += c.len_utf8();
            continue;
        }
        // ESC: complete sequence → skip; incomplete opener → buffer the tail.
        if i + 1 >= bytes.len() {
            return (out, input[i..].to_string());
        }
        let nb = bytes[i + 1];
        if nb == b']' {
            // OSC: consume through BEL or ESC-backslash.
            let mut j = i + 2;
            let mut end: Option<usize> = None;
            while j < bytes.len() {
                if bytes[j] == 0x07 {
                    end = Some(j + 1);
                    break;
                }
                if bytes[j] == 0x1b {
                    if j + 1 < bytes.len() && bytes[j + 1] == 0x5c {
                        end = Some(j + 2);
                    }
                    break;
                }
                j += 1;
            }
            match end {
                Some(end) => {
                    i = end;
                    continue;
                }
                None => return (out, input[i..].to_string()),
            }
        } else if nb == b'[' {
            // CSI: params, intermediates, then a final byte.
            let mut j = i + 2;
            while j < bytes.len() && is_csi_param(bytes[j]) {
                j += 1;
            }
            while j < bytes.len() && is_csi_intermediate(bytes[j]) {
                j += 1;
            }
            if j < bytes.len() && is_csi_final(bytes[j]) {
                i = j + 1;
                continue;
            }
            return (out, input[i..].to_string());
        } else if is_single_escape_byte(nb) {
            i += 2;
            continue;
        } else {
            // Lone ESC before a non-opener: emit literally (matches JS,
            // whose TAIL_RE only buffers structured openers).
            out.push('\x1b');
            i += 1;
        }
    }
    (out, String::new())
}

pub struct ClaudeTracker {
    state: ClaudeState,
    /// Unterminated escape opener carried across chunks.
    pending: String,
    /// Recent clean text for permission context (≤300 UTF-16 units).
    recent: String,
    /// Inactivity/permission deadline; expiry means back to idle.
    deadline: Option<Instant>,
}

// `state`/`reset` complete the ported API (and are covered by tests);
// the session loop only needs the event-driven subset below.
#[allow(dead_code)]
impl ClaudeTracker {
    pub fn new() -> Self {
        Self {
            state: ClaudeState::Idle,
            pending: String::new(),
            recent: String::new(),
            deadline: None,
        }
    }

    pub fn state(&self) -> ClaudeState {
        self.state
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        self.deadline
    }

    fn transition(
        &mut self,
        next: ClaudeState,
        context: Option<String>,
    ) -> Option<StateChange> {
        if next == self.state {
            return None;
        }
        let previous = self.state;
        self.state = next;
        Some(StateChange { state: next, previous, context })
    }

    fn push_text(&mut self, text: &str) {
        self.recent.push_str(text);
        // Bound to the last 300 UTF-16 units at char boundaries.
        let mut units: usize = self.recent.encode_utf16().count();
        if units > TEXT_BUFFER_MAX_UNITS {
            let mut drop_bytes = 0;
            for c in self.recent.chars() {
                if units <= TEXT_BUFFER_MAX_UNITS {
                    break;
                }
                units -= c.len_utf16();
                drop_bytes += c.len_utf8();
            }
            self.recent.drain(..drop_bytes);
        }
    }

    fn extract_context(&self) -> Option<String> {
        if self.recent.is_empty() {
            return None;
        }
        let lower = self.recent.to_lowercase();
        let mut best: Option<usize> = None;
        for kw in PERMISSION_KEYWORDS {
            if let Some(pos) = lower.rfind(kw) {
                if best.is_none_or(|b| pos > b) {
                    best = Some(pos);
                }
            }
        }
        let byte_pos = best?;
        // Window in chars around the hit (context is human-readable; exact
        // UTF-16-unit parity with JS is irrelevant here).
        let total: usize = self.recent.chars().count();
        let hit: usize = self.recent[..byte_pos].chars().count();
        let start = hit.saturating_sub(40);
        let end = total.min(hit + 80);
        let snippet: String = self.recent.chars().skip(start).take(end - start).collect();
        let collapsed = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            return None;
        }
        let mut out = String::new();
        if start > 0 {
            out.push_str("...");
        }
        out.push_str(&collapsed);
        if end < total {
            out.push_str("...");
        }
        Some(out)
    }

    fn process_text(&mut self, text: &str, now: Instant) -> Option<StateChange> {
        if text.contains(TOOL_MARKER) || text.chars().any(|c| SPINNERS.contains(&c)) {
            let change = self.transition(ClaudeState::Active, None);
            self.deadline = Some(now + Duration::from_millis(INACTIVITY_MS));
            return change;
        }
        self.push_text(text);
        if contains_permission_keyword(text) && self.state == ClaudeState::Active {
            let context = self.extract_context();
            let change = self.transition(ClaudeState::PermissionWait, context);
            self.deadline = Some(now + Duration::from_millis(PERMISSION_MS));
            return change;
        }
        None
    }

    /// Feed raw PTY bytes; returns a transition when the state flips.
    pub fn process_bytes(&mut self, bytes: &[u8], now: Instant) -> Option<StateChange> {
        // Lossy per packet — mirrors JS TextDecoder without `stream:true`.
        let mut data = std::mem::take(&mut self.pending);
        data.push_str(&String::from_utf8_lossy(bytes));
        let (clean, tail) = split_escapes(&data);
        self.pending = tail;
        if clean.trim().is_empty() {
            return None;
        }
        self.process_text(&clean, now)
    }

    /// Fire on the armed deadline; returns the idle transition if it lapsed.
    pub fn check_timeout(&mut self, now: Instant) -> Option<StateChange> {
        match self.deadline {
            Some(d) if now >= d => {
                self.deadline = None;
                self.transition(ClaudeState::Idle, None)
            }
            _ => None,
        }
    }

    pub fn reset(&mut self) {
        self.state = ClaudeState::Idle;
        self.pending.clear();
        self.recent.clear();
        self.deadline = None;
    }
}

impl Default for ClaudeTracker {
    fn default() -> Self {
        Self::new()
    }
}

fn contains_permission_keyword(lower_or_text: &str) -> bool {
    // Case-insensitive substrate: lowercase once per call (chunks are small;
    // the 300-unit recent buffer is searched separately for context).
    let lower = lower_or_text.to_lowercase();
    PERMISSION_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> Instant {
        Instant::now()
    }

    #[test]
    fn strips_complete_sequences() {
        let (clean, tail) = split_escapes("\x1b]0;title\x07hello\x1b[31mX\x1bM!");
        assert_eq!(clean, "helloX!");
        assert_eq!(tail, "");
    }

    #[test]
    fn strips_c0_controls_but_keeps_tab_and_newline() {
        // BEL/CR/NUL/DEL are stripped; lone ESC + 'd' is kept literally.
        let (clean, _) = split_escapes("a\x00b\x07c\x1bd\t\n\x7f!");
        assert_eq!(clean, "abc\x1bd\t\n!");
    }

    #[test]
    fn lone_escape_before_text_is_kept() {
        let (clean, tail) = split_escapes("\x1bfoo");
        assert_eq!(clean, "\x1bfoo");
        assert_eq!(tail, "");
    }

    #[test]
    fn incomplete_tail_buffers_across_chunks() {
        let mut t = ClaudeTracker::new();
        // CSI split across packets.
        let (clean, tail) = split_escapes("ab\x1b[38;5;");
        assert_eq!(clean, "ab");
        assert_eq!(tail, "\x1b[38;5;");
        t.pending = tail;
        let (clean2, tail2) = split_escapes(&(t.pending.clone() + "196mX"));
        assert_eq!(clean2, "X");
        assert_eq!(tail2, "");
        // OSC split across packets.
        let (c3, t3) = split_escapes("hi\x1b]0;ti");
        assert_eq!(c3, "hi");
        assert_eq!(t3, "\x1b]0;ti");
        let (c4, t4) = split_escapes(&(t3 + "tle\x07!"));
        assert_eq!(c4, "!");
        assert_eq!(t4, "");
        // Lone trailing ESC buffers.
        let (c5, t5) = split_escapes("ab\x1b");
        assert_eq!(c5, "ab");
        assert_eq!(t5, "\x1b");
    }

    #[test]
    fn tool_marker_activates() {
        let mut t = ClaudeTracker::new();
        assert_eq!(t.state(), ClaudeState::Idle);
        let change = t.process_bytes("⏺ working".as_bytes(), now());
        let change = change.expect("marker must activate");
        assert_eq!(change.state, ClaudeState::Active);
        assert_eq!(change.previous, ClaudeState::Idle);
        assert!(t.next_deadline().is_some());
        // Repeated markers refresh but don't re-emit.
        assert!(t.process_bytes("⏺ more".as_bytes(), now()).is_none());
        assert_eq!(t.state(), ClaudeState::Active);
    }

    #[test]
    fn spinner_activates() {
        let mut t = ClaudeTracker::new();
        assert!(t.process_bytes("◐ thinking".as_bytes(), now()).is_some());
        assert_eq!(t.state(), ClaudeState::Active);
    }

    #[test]
    fn permission_waits_only_while_active() {
        let mut t = ClaudeTracker::new();
        // Idle + permission text: buffered, no transition (mirrors JS).
        assert!(t.process_bytes("do you want to proceed?".as_bytes(), now()).is_none());
        assert_eq!(t.state(), ClaudeState::Idle);
        // Activate, then permission text → wait with context.
        assert!(t.process_bytes("◐ go".as_bytes(), now()).is_some());
        let change = t
            .process_bytes("Should I allow this? [allow]".as_bytes(), now())
            .expect("permission must trigger");
        assert_eq!(change.state, ClaudeState::PermissionWait);
        assert_eq!(change.previous, ClaudeState::Active);
        let ctx = change.context.expect("context expected");
        assert!(ctx.to_lowercase().contains("allow"));
    }

    #[test]
    fn whitespace_only_is_ignored() {
        let mut t = ClaudeTracker::new();
        assert!(t.process_bytes(b"  \n\t ", now()).is_none());
        assert!(t.next_deadline().is_none());
    }

    #[test]
    fn timeout_returns_to_idle() {
        let mut t = ClaudeTracker::new();
        let start = now();
        assert!(t.process_bytes("⏺ x".as_bytes(), start).is_some());
        assert!(t.check_timeout(start + Duration::from_millis(INACTIVITY_MS - 1)).is_none());
        let change = t
            .check_timeout(start + Duration::from_millis(INACTIVITY_MS + 1))
            .expect("must idle after deadline");
        assert_eq!(change.state, ClaudeState::Idle);
        assert_eq!(change.previous, ClaudeState::Active);
        assert!(t.next_deadline().is_none());
        // Second fire is a no-op.
        assert!(t.check_timeout(start + Duration::from_millis(INACTIVITY_MS + 5000)).is_none());
    }

    #[test]
    fn text_buffer_stays_bounded() {
        let mut t = ClaudeTracker::new();
        t.process_bytes(&vec![b'x'; 1000], now());
        assert!(t.recent.encode_utf16().count() <= TEXT_BUFFER_MAX_UNITS);
        // Multi-byte chars never split a surrogate pair in the bound.
        t.process_bytes(&"é".repeat(500).into_bytes(), now());
        assert!(t.recent.encode_utf16().count() <= TEXT_BUFFER_MAX_UNITS);
        for _ in t.recent.chars() {}
    }

    #[test]
    fn empty_and_plain_text_do_nothing() {
        let mut t = ClaudeTracker::new();
        assert!(t.process_bytes(b"", now()).is_none());
        assert!(t.process_bytes(b"regular output line", now()).is_none());
        assert_eq!(t.state(), ClaudeState::Idle);
    }
}
