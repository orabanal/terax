use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use russh::client::{self, Config, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde::Deserialize;
use tauri::ipc::{Channel, Response};
use tauri::Emitter;
use tokio::net::lookup_host;
use tokio::sync::{mpsc, Mutex};

mod claude_tracker;
use claude_tracker::{ClaudeTracker, SshAgentState, StateChange};

pub struct SshState {
    sessions: Arc<RwLock<HashMap<u32, Arc<SshSession>>>>,
    next_id: AtomicU32,
}

#[derive(Default)]
pub struct SshTailState {
    tails: Arc<RwLock<HashMap<u32, TailEntry>>>,
    next_id: AtomicU32,
}

/// A running remote tail: abort handle plus a shutdown signal. Stopping
/// sends shutdown first so the task closes its channel explicitly
/// (killing the remote `tail -F`); abort is only the backstop. Previously
/// stop just aborted and russh `Channel` has no Drop-close, so every
/// stopped tail leaked a `tail -F` on the server.
struct TailEntry {
    abort: tokio::task::AbortHandle,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshTailChunk {
    pub tail_id: u32,
    pub ssh_id: u32,
    pub chunk: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshTailClosed {
    pub tail_id: u32,
    pub ssh_id: u32,
}

/// Stream a remote file (used for `~/.terax-opencode-events.jsonl`) over a
/// dedicated exec channel. Chunks arrive as `terax:opencode-tail`; the
/// frontend reassembles lines. Ends with `terax:opencode-tail-closed` when
/// the channel breaks (disconnect, file missing with plain `tail`).
#[tauri::command]
pub async fn ssh_tail_start(
    app: tauri::AppHandle,
    ssh: tauri::State<'_, SshState>,
    tails: tauri::State<'_, SshTailState>,
    id: u32,
    path: String,
) -> Result<u32, String> {
    use tauri::Emitter;
    let handle = {
        let sessions = ssh.sessions.read().unwrap();
        let s = sessions
            .get(&id)
            .ok_or_else(|| format!("no ssh session {id}"))?;
        s.handle.clone()
    };
    let mut channel = {
        let h = handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| format!("Failed to open tail channel: {e}"))?
    };
    // -n0: only new lines (never replay). -F: survive rotation/recreate.
    // NOTE: a quoted '~' never expands in sh, so map ~/... to $HOME/...
    // with only the remainder quoted. (A literal '~/.terax-...' path made
    // the tail watch a phantom file forever: total remote silence.)
    let file_arg = match path.strip_prefix("~/") {
        Some(rest) => format!("$HOME/{}", shell_escape(rest)),
        None => shell_escape(&path),
    };
    let cmd = format!("tail -n0 -F {file_arg}");
    channel
        .exec(true, cmd.as_bytes())
        .await
        .map_err(|e| format!("tail exec failed: {e}"))?;

    let tail_id = tails.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let app_clone = app.clone();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = &mut shutdown_rx => {
                    let _ = channel.close().await;
                    break;
                }
                msg = channel.wait() => match msg {
                    None => break,
                    Some(ChannelMsg::Data { data }) => {
                        let chunk = String::from_utf8_lossy(&data).into_owned();
                        if chunk.is_empty() {
                            continue;
                        }
                        let _ = app_clone.emit(
                            "terax:opencode-tail",
                            SshTailChunk { tail_id, ssh_id: id, chunk },
                        );
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                    Some(_) => {}
                }
            }
        }
        let _ = app_clone.emit(
            "terax:opencode-tail-closed",
            SshTailClosed { tail_id, ssh_id: id },
        );
    });
    tails.tails.write().unwrap().insert(
        tail_id,
        TailEntry {
            abort: join.abort_handle(),
            shutdown: Some(shutdown_tx),
        },
    );
    Ok(tail_id)
}

#[tauri::command]
pub async fn ssh_tail_stop(
    tails: tauri::State<'_, SshTailState>,
    tail_id: u32,
) -> Result<(), String> {
    let entry = tails.tails.write().unwrap().remove(&tail_id);
    if let Some(mut entry) = entry {
        // Ask the task to close its channel (kills remote `tail -F`);
        // abort covers a wedged task. Send failing just means the task
        // already ended, which also means the channel is gone.
        if let Some(tx) = entry.shutdown.take() {
            let _ = tx.send(());
        }
        entry.abort.abort();
    }
    Ok(())
}

/// Minimal single-quote shell escaping for a remote path argument.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Quote a remote path for POSIX sh, leaving plain paths bare so terminals
/// show `cd /ruta/rutab` instead of `cd '/ruta/rutab'`. Same safe set as the
/// frontend `quoteShellArg` (keep them in sync): alphanumerics plus a
/// conservative punctuation set; empty and leading-dash values stay quoted.
fn shell_quote(arg: &str) -> String {
    fn bare_safe(b: u8) -> bool {
        matches!(
            b,
            b'0'..=b'9'
                | b'a'..=b'z'
                | b'A'..=b'Z'
                | b'_'
                | b'@'
                | b'%'
                | b'+'
                | b'='
                | b':'
                | b','
                | b'.'
                | b'/'
                | b'~'
                | b'-'
        )
    }
    if !arg.is_empty() && !arg.starts_with('-') && arg.bytes().all(bare_safe) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('\'');
    let mut first = true;
    for part in arg.split('\'') {
        if !first {
            out.push_str("'\\''");
        }
        first = false;
        out.push_str(part);
    }
    out.push('\'');
    out
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }
}

impl SshState {
    /// Clone the transport handle of a live session so other subsystems
    /// (SFTP) can multiplex on the same TCP connection instead of paying
    /// a second handshake + auth (M3).
    pub(crate) fn session_handle(
        &self,
        id: u32,
    ) -> Option<Arc<Mutex<Handle<ClientHandler>>>> {
        self.sessions.read().unwrap().get(&id).map(|s| s.handle.clone())
    }
}

struct SshSession {
    tx: mpsc::Sender<Vec<u8>>,
    resize_tx: mpsc::Sender<(u32, u32)>,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    /// Pump + read-loop tasks. Aborted on close so no task (and no remote
    /// shell) outlives the session: previously `ssh_close` only forgot the
    /// id and every closed tab leaked a server-side shell.
    tasks: std::sync::Mutex<Vec<tokio::task::AbortHandle>>,
}

pub(crate) struct ClientHandler {
    host: String,
    port: u16,
    policy: HostKeyPolicy,
}

/// What to do with the server's host key. Mirrors the
/// `strictHostKeyChecking` host setting (`yes` / `accept-new` / `no`).
/// Unset behaves as `accept-new` (OpenSSH-equivalent default for
/// non-interactive use): first contact learns the key, later changes
/// are rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostKeyPolicy {
    /// Accept only keys already recorded in known_hosts.
    Strict,
    /// Learn unknown keys, reject changed ones.
    AcceptNew,
    /// Accept everything (previous behavior; explicit opt-out only).
    Disabled,
}

pub(crate) fn parse_host_key_policy(s: Option<&str>) -> HostKeyPolicy {
    match s {
        Some("yes") => HostKeyPolicy::Strict,
        Some("no") => HostKeyPolicy::Disabled,
        _ => HostKeyPolicy::AcceptNew,
    }
}

/// Outcome of checking one key against a known_hosts file.
#[derive(Debug, PartialEq, Eq)]
enum HostKeyCheck {
    /// Recorded and matching.
    Match,
    /// No entry for this host.
    Unknown,
    /// Entry exists with a different key (possible MITM).
    Changed { line: usize },
}

fn check_host_key_at(
    host: &str,
    port: u16,
    key: &russh::keys::ssh_key::PublicKey,
    known_hosts: &std::path::Path,
) -> HostKeyCheck {
    use russh::keys::known_hosts::check_known_hosts_path;
    match check_known_hosts_path(host, port, key, known_hosts) {
        Ok(true) => HostKeyCheck::Match,
        Ok(false) => HostKeyCheck::Unknown,
        Err(russh::keys::Error::KeyChanged { line }) => HostKeyCheck::Changed { line },
        // Unreadable/malformed file reads as "no usable entry": strict
        // rejects below, accept-new learns over it.
        Err(_) => HostKeyCheck::Unknown,
    }
}

/// Pure policy decision, unit-tested: given the check outcome, may the
/// connection proceed, and must the key be recorded first?
#[derive(Debug, PartialEq, Eq)]
enum HostKeyDecision {
    Accept,
    LearnThenAccept,
    RejectChanged,
    RejectUnknown,
}

fn decide_host_key(policy: HostKeyPolicy, check: &HostKeyCheck) -> HostKeyDecision {
    match (policy, check) {
        (_, HostKeyCheck::Match) => HostKeyDecision::Accept,
        (HostKeyPolicy::Disabled, _) => HostKeyDecision::Accept,
        (HostKeyPolicy::AcceptNew, HostKeyCheck::Unknown) => {
            HostKeyDecision::LearnThenAccept
        }
        (HostKeyPolicy::AcceptNew, HostKeyCheck::Changed { .. }) => {
            HostKeyDecision::RejectChanged
        }
        (HostKeyPolicy::Strict, HostKeyCheck::Unknown) => HostKeyDecision::RejectUnknown,
        (HostKeyPolicy::Strict, HostKeyCheck::Changed { .. }) => {
            HostKeyDecision::RejectChanged
        }
    }
}

fn known_hosts_path() -> Option<std::path::PathBuf> {
    // $HOME (not deprecated std::env::home_dir).
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|h| h.join(".ssh").join("known_hosts"))
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            // CA-pinned certificates are out of scope: accept (documented).
            russh::keys::PublicKeyOrCertificate::Certificate(_) => return Ok(true),
        };
        let host = self.host.clone();
        let port = self.port;
        let policy = self.policy;
        let decision = tokio::task::spawn_blocking(move || {
            let path = known_hosts_path();
            let check = match &path {
                Some(p) => check_host_key_at(&host, port, &key, p),
                None => HostKeyCheck::Unknown,
            };
            let decision = decide_host_key(policy, &check);
            if decision == HostKeyDecision::LearnThenAccept {
                if let Some(p) = &path {
                    if let Some(parent) = p.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    use russh::keys::known_hosts::learn_known_hosts_path;
                    if learn_known_hosts_path(&host, port, &key, p).is_err() {
                        return HostKeyDecision::RejectUnknown;
                    }
                } else {
                    return HostKeyDecision::RejectUnknown;
                }
            }
            decision
        })
        .await
        .map_err(|_| russh::Error::Disconnect)?;
        match decision {
            HostKeyDecision::Accept | HostKeyDecision::LearnThenAccept => Ok(true),
            HostKeyDecision::RejectChanged => {
                log::warn!(
                    "ssh {}:{}: HOST KEY CHANGED — possible MITM, connection refused",
                    self.host,
                    self.port
                );
                Ok(false)
            }
            HostKeyDecision::RejectUnknown => {
                log::warn!(
                    "ssh {}:{}: unknown host key rejected under strict policy",
                    self.host,
                    self.port
                );
                Ok(false)
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub connect_timeout: Option<u64>,
    pub keep_alive_interval: Option<u64>,
    pub keep_alive_max: Option<u64>,
    pub cwd: Option<String>,
    /// Mirrors the host's `strictHostKeyChecking` setting
    /// (`yes` / `accept-new` / `no`); unset means `accept-new`.
    #[serde(default)]
    pub strict_host_key_checking: Option<String>,
}

/// Connect to an SSH server and authenticate. Returns the authenticated handle.
/// Reusable by both SSH PTY sessions and SFTP sessions.
pub(crate) async fn connect_and_auth(
    opts: &SshOpenOptions,
) -> Result<Handle<ClientHandler>, String> {
    let timeout_secs = opts.connect_timeout.unwrap_or(15);

    let addr_str = format!("{}:{}", opts.host, opts.port);
    let addr = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        lookup_host(&addr_str),
    )
    .await
    .map_err(|_| format!("DNS resolution timed out for '{}'", opts.host))?
    .map_err(|e| format!("DNS resolution failed for '{}': {e}", opts.host))?
    .next()
    .ok_or_else(|| format!("No addresses found for '{}'", opts.host))?;

    let config = Arc::new(Config {
        // A1: keepalive ON unless the host opts out — idle TCP through
        // NAT/firewalls otherwise dies silently mid agent-run. 60s matches
        // the Settings placeholder that most hosts already carry.
        keepalive_interval: Some(Duration::from_secs(
            opts.keep_alive_interval.unwrap_or(60),
        )),
        keepalive_max: opts.keep_alive_max.unwrap_or(3) as usize,
        nodelay: true,
        ..<_>::default()
    });

    let policy = parse_host_key_policy(opts.strict_host_key_checking.as_deref());
    let sh = ClientHandler {
        host: opts.host.clone(),
        port: opts.port,
        policy,
    };
    let mut session: Handle<ClientHandler> =
        tokio::time::timeout(Duration::from_secs(timeout_secs), client::connect(config, addr, sh))
            .await
            .map_err(|_| format!("Connection timed out after {}s", timeout_secs))?
            .map_err(|e| format!("TCP connect failed: {e}"))?;

    let auth_ok = if opts.auth_type == "key" {
        let key_path = opts
            .key_path
            .as_deref()
            .ok_or("Key path required for key auth")?;
        let expanded = shellexpand::tilde(key_path).into_owned();
        let key_pair = load_secret_key(&expanded, None)
            .map_err(|e| format!("Failed to load key '{expanded}': {e}"))?;
        let best_hash = session
            .best_supported_rsa_hash()
            .await
            .map_err(|e| e.to_string())?
            .flatten();
        let result = session
            .authenticate_publickey(
                &opts.username,
                PrivateKeyWithHashAlg::new(Arc::new(key_pair), best_hash),
            )
            .await
            .map_err(|e| format!("Public key auth error: {e}"))?;
        result.success()
    } else {
        let password = opts.password.as_deref().unwrap_or("");
        if password.is_empty() {
            return Err("Password is required for password auth. Configure it in SSH Settings.".to_string());
        }
        let result = session
            .authenticate_password(&opts.username, password)
            .await
            .map_err(|e| format!("Password auth error: {e}"))?;
        result.success()
    };

    if !auth_ok {
        return Err("Authentication failed — wrong username, password, or key.".to_string());
    }

    Ok(session)
}

#[tauri::command]
pub async fn ssh_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, SshState>,
    opts: SshOpenOptions,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    on_status: Channel<String>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let _ = on_status.send("Resolving host...".to_string());
    let _ = on_status.send("TCP connecting...".to_string());
    let _ = on_status.send("Authenticating...".to_string());

    let session = connect_and_auth(&opts).await?;

    let _ = on_status.send("Opening PTY channel...".to_string());

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {e}"))?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            opts.cols as u32,
            opts.rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| format!("PTY request failed: {e}"))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Shell request failed: {e}"))?;

    let _ = on_status.send("Connected".to_string());

    // Deep enough that a stalled server costs delayed (not lost) keystrokes.
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(512);
    let (resize_tx, resize_rx) = mpsc::channel::<(u32, u32)>(8);

    if let Some(ref cwd) = opts.cwd {
        let _ = input_tx
            .send(format!("cd {}\r", shell_quote(cwd)).into_bytes())
            .await;
    }

    let handle = Arc::new(Mutex::new(session));
    let ssh_session = Arc::new(SshSession {
        tx: input_tx,
        resize_tx,
        handle: handle.clone(),
        tasks: std::sync::Mutex::new(Vec::new()),
    });
    state.sessions.write().unwrap().insert(id, ssh_session.clone());

    let sessions = state.inner().sessions.clone();
    let app_loop = app.clone();
    // Split the channel: reads stay in the loop, writes move to a dedicated
    // pump. `channel.data()` parks until the server opens its window (busy
    // foreground not reading stdin); doing that inside the read loop used
    // to freeze output processing, flushes and timers for seconds at a
    // time — total UI death while the server caught up. Now a closed window
    // only delays keystrokes (buffered in the mpsc above).
    let (mut read_half, write_half) = channel.split();
    let pump_join = tokio::spawn(async move {
        let mut input_rx = input_rx;
        let mut resize_rx = resize_rx;
        let mut stalled = false;
        loop {
            tokio::select! {
                biased;

                res = input_rx.recv() => {
                    match res {
                        Some(data) => {
                            let start = tokio::time::Instant::now();
                            let ok = write_half.data(data.as_ref()).await.is_ok();
                            // Forensics for "typed but nothing echoes" reports:
                            // a slow send means the server isn't reading.
                            if start.elapsed() > std::time::Duration::from_secs(1) {
                                if !stalled {
                                    stalled = true;
                                    log::warn!(
                                        "ssh session {id}: server window closed, input stalled"
                                    );
                                }
                            } else {
                                stalled = false;
                            }
                            if !ok {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                Some((cols, rows)) = resize_rx.recv() => {
                    let _ = write_half.window_change(cols, rows, 0, 0).await;
                }
            }
        }
    });
    ssh_session.tasks.lock().unwrap().push(pump_join.abort_handle());
    let read_join = tokio::spawn(async move {
        let exit_code = run_ssh_loop(&mut read_half, &on_data, &app_loop, id).await;
        sessions.write().unwrap().remove(&id);
        if exit_code == EXIT_CONNECTION_LOST {
            log::warn!("ssh session {id}: connection lost (keepalive timeout or transport failure)");
            let _ = on_status.send("Disconnected".to_string());
        }
        let _ = on_exit.send(exit_code);
        let h = handle.lock().await;
        let _ = h.disconnect(Disconnect::ByApplication, "", "English").await;
    });
    ssh_session.tasks.lock().unwrap().push(read_join.abort_handle());

    Ok(id)
}

/// Channel closed without an exit status: the transport died (keepalive
/// timeout, TCP reset, server disconnect) rather than the remote shell
/// exiting cleanly.
const EXIT_CONNECTION_LOST: i32 = -1;

/// Output coalescing policy for the interactive SSH loop: one IPC Channel
/// send per SSH packet used to mean hundreds of webview wakeups per second
/// while an agent streams (packets are often a few hundred bytes). Buffer
/// instead and flush by size (64KB) or age (6ms, matching the local PTY
/// flusher's 4ms order), so the frontend gets a handful of large writes
/// that its own rAF coalescing turns into one `term.write()` per frame.
const COALESCE_MAX_BYTES: usize = 64 * 1024;
const COALESCE_FLUSH_INTERVAL: Duration = Duration::from_millis(6);

/// Pure flush rule, unit-tested: flush when the buffer hits the size cap or
/// the oldest buffered byte ages out.
fn flush_due(buffered_bytes: usize, deadline_elapsed: bool) -> bool {
    deadline_elapsed || buffered_bytes >= COALESCE_MAX_BYTES
}

/// Drain the coalescing buffer into one IPC send. Returns `false` when the
/// frontend is gone (caller must stop the loop).
fn flush_pending(
    pending: &mut Vec<u8>,
    deadline: &mut Option<tokio::time::Instant>,
    on_data: &Channel<Response>,
) -> bool {
    if pending.is_empty() {
        return true;
    }
    let bytes = std::mem::take(pending);
    *deadline = None;
    on_data.send(Response::new(bytes)).is_ok()
}

/// Forward an agent-state transition to the frontend (rare: only on flips,
/// never per chunk — the whole point of tracking in Rust).
fn emit_agent_state(app: &tauri::AppHandle, ssh_id: u32, change: &StateChange) {
    let _ = app.emit(
        "terax:ssh-agent-state",
        SshAgentState {
            ssh_id,
            state: change.state,
            previous_state: change.previous,
            context: change.context.clone(),
        },
    );
}

/// Read-only event loop: PTY output, flush + tracker timers, EOF/exit.
/// Input and resizes run in the dedicated pump task (see ssh_open), so a
/// closed server window can never park output processing again.
async fn run_ssh_loop(
    read: &mut russh::ChannelReadHalf,
    on_data: &Channel<Response>,
    app: &tauri::AppHandle,
    ssh_id: u32,
) -> i32 {
    let mut pending: Vec<u8> = Vec::new();
    let mut flush_deadline: Option<tokio::time::Instant> = None;
    // Claude Code activity tracking over the coalesced stream (replaces the
    // old per-chunk JS tracker): transitions emit one event each.
    let mut tracker = ClaudeTracker::new();
    let mut idle_deadline: Option<tokio::time::Instant> = None;
    loop {
        // Timer arm: fires when the oldest buffered byte ages out; never
        // ready while the buffer is empty. Snapshot first (Option<Instant>
        // is Copy) so the future owns its deadline and never borrows
        // `flush_deadline`, which the select branches mutate.
        let armed = flush_deadline;
        let flush_wait = async move {
            if let Some(deadline) = armed {
                tokio::time::sleep_until(deadline).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(flush_wait);
        // Inactivity arm for the agent tracker (same snapshot pattern).
        let armed_idle = idle_deadline;
        let idle_wait = async move {
            if let Some(deadline) = armed_idle {
                tokio::time::sleep_until(deadline).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(idle_wait);

        // `biased` keeps the flush cadence deterministic under flood (timer
        // first) and user keystrokes responsive (input before data).
        tokio::select! {
            biased;

            _ = &mut flush_wait => {
                if !flush_pending(&mut pending, &mut flush_deadline, on_data) {
                    return 0;
                }
            }

            _ = &mut idle_wait => {
                let now = tokio::time::Instant::now();
                if let Some(change) = tracker.check_timeout(now) {
                    emit_agent_state(app, ssh_id, &change);
                }
                idle_deadline = tracker.next_deadline();
            }

            msg = read.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let now = tokio::time::Instant::now();
                        if let Some(change) = tracker.process_bytes(&data, now) {
                            emit_agent_state(app, ssh_id, &change);
                        }
                        idle_deadline = tracker.next_deadline();
                        if pending.is_empty() {
                            flush_deadline = Some(
                                tokio::time::Instant::now() + COALESCE_FLUSH_INTERVAL,
                            );
                        }
                        pending.extend_from_slice(&data);
                        if flush_due(pending.len(), false)
                            && !flush_pending(&mut pending, &mut flush_deadline, on_data)
                        {
                            return 0;
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        flush_pending(&mut pending, &mut flush_deadline, on_data);
                        return exit_status as i32;
                    }
                    Some(ChannelMsg::Eof) => {
                        flush_pending(&mut pending, &mut flush_deadline, on_data);
                        return 0;
                    }
                    Some(_) => {}
                    None => {
                        flush_pending(&mut pending, &mut flush_deadline, on_data);
                        return EXIT_CONNECTION_LOST;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flush_policy_within_spec() {
        // Spec: flush by size (64KB) or age (~4–8ms, local-PTY order).
        assert_eq!(COALESCE_MAX_BYTES, 64 * 1024);
        assert!(COALESCE_FLUSH_INTERVAL >= Duration::from_millis(4));
        assert!(COALESCE_FLUSH_INTERVAL <= Duration::from_millis(8));
    }

    #[test]
    fn flush_due_on_size_cap() {
        assert!(!flush_due(0, false));
        assert!(!flush_due(COALESCE_MAX_BYTES - 1, false));
        assert!(flush_due(COALESCE_MAX_BYTES, false));
        assert!(flush_due(COALESCE_MAX_BYTES + 1, false));
    }

    #[test]
    fn flush_due_on_elapsed_deadline() {
        assert!(flush_due(0, true));
        assert!(flush_due(1, true));
        assert!(flush_due(COALESCE_MAX_BYTES - 1, true));
    }

    #[test]
    fn host_key_policy_parse() {
        assert_eq!(parse_host_key_policy(None), HostKeyPolicy::AcceptNew);
        assert_eq!(parse_host_key_policy(Some("accept-new")), HostKeyPolicy::AcceptNew);
        assert_eq!(parse_host_key_policy(Some("yes")), HostKeyPolicy::Strict);
        assert_eq!(parse_host_key_policy(Some("no")), HostKeyPolicy::Disabled);
        // Unknown values fail closed-ish: learn but never blindly trust.
        assert_eq!(parse_host_key_policy(Some("ask")), HostKeyPolicy::AcceptNew);
    }

    #[test]
    fn host_key_decision_matrix() {
        use HostKeyCheck as C;
        use HostKeyDecision as D;
        // Match always proceeds.
        for p in [HostKeyPolicy::Strict, HostKeyPolicy::AcceptNew, HostKeyPolicy::Disabled] {
            assert_eq!(decide_host_key(p, &C::Match), D::Accept);
        }
        // Changed key: rejected unless explicitly disabled.
        assert_eq!(
            decide_host_key(HostKeyPolicy::Strict, &C::Changed { line: 3 }),
            D::RejectChanged
        );
        assert_eq!(
            decide_host_key(HostKeyPolicy::AcceptNew, &C::Changed { line: 3 }),
            D::RejectChanged
        );
        assert_eq!(
            decide_host_key(HostKeyPolicy::Disabled, &C::Changed { line: 3 }),
            D::Accept
        );
        // Unknown: strict rejects, accept-new learns, disabled accepts.
        assert_eq!(
            decide_host_key(HostKeyPolicy::Strict, &C::Unknown),
            D::RejectUnknown
        );
        assert_eq!(
            decide_host_key(HostKeyPolicy::AcceptNew, &C::Unknown),
            D::LearnThenAccept
        );
        assert_eq!(
            decide_host_key(HostKeyPolicy::Disabled, &C::Unknown),
            D::Accept
        );
    }

    fn temp_known_hosts(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "terax-test-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        let _ = std::fs::remove_file(&p);
        p
    }

    const KEY_A_B64: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ";
    const KEY_B_B64: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G2sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X";

    #[test]
    fn host_key_check_against_file() {
        use russh::keys::parse_public_key_base64;
        let path = temp_known_hosts("kh");
        let key_a = parse_public_key_base64(KEY_A_B64).unwrap();
        let key_b = parse_public_key_base64(KEY_B_B64).unwrap();
        // Missing file reads as unknown (strict rejects, accept-new learns).
        assert_eq!(check_host_key_at("h.test", 22, &key_a, &path), HostKeyCheck::Unknown);
        // Learn, then match.
        russh::keys::known_hosts::learn_known_hosts_path("h.test", 22, &key_a, &path)
            .unwrap();
        assert_eq!(check_host_key_at("h.test", 22, &key_a, &path), HostKeyCheck::Match);
        // Different key for the same host: changed (possible MITM).
        assert!(matches!(
            check_host_key_at("h.test", 22, &key_b, &path),
            HostKeyCheck::Changed { .. }
        ));
        // Non-standard port is a separate entry.
        assert_eq!(check_host_key_at("h.test", 2222, &key_a, &path), HostKeyCheck::Unknown);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn shell_quote_leaves_safe_paths_bare() {
        assert_eq!(shell_quote("/ruta/rutab"), "/ruta/rutab");
        assert_eq!(shell_quote("C:/Users/dev"), "C:/Users/dev");
        assert_eq!(shell_quote("~/docs"), "~/docs");
        assert_eq!(shell_quote("a-b_c.d:e@f+g%h,i~j"), "a-b_c.d:e@f+g%h,i~j");
    }

    #[test]
    fn shell_quote_quotes_unsafe() {
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("-foo"), "'-foo'");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("$HOME/x"), "'$HOME/x'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}

#[tauri::command]
pub async fn ssh_write(
    state: tauri::State<'_, SshState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let s = sessions
        .get(&id)
        .ok_or_else(|| format!("no ssh session {id}"))?;
    s.tx.try_send(data.into_bytes())
        .map_err(|e| format!("ssh_write send failed: {e}"))
}

#[tauri::command]
pub async fn ssh_resize(
    state: tauri::State<'_, SshState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let s = sessions
        .get(&id)
        .ok_or_else(|| format!("no ssh session {id}"))?;
    s.resize_tx
        .try_send((cols as u32, rows as u32))
        .map_err(|e| format!("ssh_resize send failed: {e}"))
}

/// Close an SSH session for real: abort pump + read tasks (which drops
/// the channel halves and ends the remote shell) and send disconnect.
/// Idempotent — closing twice or closing a dead session is Ok.
#[tauri::command]
pub async fn ssh_close(state: tauri::State<'_, SshState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    let Some(session) = session else {
        return Ok(());
    };
    for task in session.tasks.lock().unwrap().drain(..) {
        task.abort();
    }
    // Dropping the tasks drops the channel halves; the explicit disconnect
    // ends the transport even if a task lingers mid-abort.
    let h = session.handle.lock().await;
    let _ = h.disconnect(Disconnect::ByApplication, "", "English").await;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
}

/// Execute a command on the remote SSH server via a separate exec channel.
/// This runs silently — the command is NOT visible in the user's interactive terminal.
///
/// Backstop timeout (A3): the frontend abandons slow probes with its own
/// shorter races, but an abandoned frontend must not leave the remote
/// command and channel running forever. Past this deadline the channel is
/// dropped (remote side sees EOF/close) and an error is returned.
const SSH_EXEC_TIMEOUT: Duration = Duration::from_secs(30);

#[tauri::command]
pub async fn ssh_exec(
    state: tauri::State<'_, SshState>,
    id: u32,
    command: String,
) -> Result<SshExecResult, String> {
    let handle = {
        let sessions = state.sessions.read().unwrap();
        let s = sessions
            .get(&id)
            .ok_or_else(|| format!("no ssh session {id}"))?;
        s.handle.clone()
    };

    let mut channel = {
        let h = handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| format!("Failed to open exec channel: {e}"))?
    };

    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("exec request failed: {e}"))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code: Option<u32> = None;

    let drained = tokio::time::timeout(SSH_EXEC_TIMEOUT, async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status);
                }
                ChannelMsg::Eof => break,
                _ => {}
            }
        }
    })
    .await;
    // Dropping `channel` here closes the remote command on timeout too.
    drop(channel);
    if drained.is_err() {
        return Err(format!(
            "exec timed out after {}s (remote command killed)",
            SSH_EXEC_TIMEOUT.as_secs()
        ));
    }

    Ok(SshExecResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code,
    })
}
