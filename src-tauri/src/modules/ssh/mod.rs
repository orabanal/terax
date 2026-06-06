use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use russh::client::{self, Config, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde::Deserialize;
use tauri::ipc::{Channel, Response};
use tokio::net::lookup_host;
use tokio::sync::mpsc;

pub struct SshState {
    sessions: Arc<RwLock<HashMap<u32, Arc<SshSession>>>>,
    next_id: AtomicU32,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }
}

struct SshSession {
    tx: mpsc::Sender<Vec<u8>>,
    resize_tx: mpsc::Sender<(u32, u32)>,
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
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
}

#[tauri::command]
pub async fn ssh_open(
    state: tauri::State<'_, SshState>,
    opts: SshOpenOptions,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    on_status: Channel<String>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let timeout_secs = opts.connect_timeout.unwrap_or(15);

    let _ = on_status.send("Resolving host...".to_string());

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
        keepalive_interval: opts.keep_alive_interval.map(Duration::from_secs),
        keepalive_max: opts.keep_alive_max.unwrap_or(3) as usize,
        nodelay: true,
        ..<_>::default()
    });

    let _ = on_status.send("TCP connecting...".to_string());

    let sh = ClientHandler;
    let mut session: Handle<ClientHandler> =
        tokio::time::timeout(Duration::from_secs(timeout_secs), client::connect(config, addr, sh))
            .await
            .map_err(|_| format!("Connection timed out after {}s", timeout_secs))?
            .map_err(|e| format!("TCP connect failed: {e}"))?;

    let _ = on_status.send("Authenticating...".to_string());

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

    let _ = on_status.send("Opening PTY channel...".to_string());

    let mut channel = session
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

    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(8);

    let ssh_session = Arc::new(SshSession {
        tx: input_tx,
        resize_tx,
    });
    state.sessions.write().unwrap().insert(id, ssh_session);

    let sessions = state.inner().sessions.clone();
    tauri::async_runtime::spawn(async move {
        let exit_code = run_ssh_loop(&mut channel, &mut input_rx, &mut resize_rx, &on_data).await;
        sessions.write().unwrap().remove(&id);
        let _ = on_exit.send(exit_code);
        let _ = session.disconnect(Disconnect::ByApplication, "", "English").await;
    });

    Ok(id)
}

async fn run_ssh_loop(
    channel: &mut russh::Channel<russh::client::Msg>,
    input_rx: &mut mpsc::Receiver<Vec<u8>>,
    resize_rx: &mut mpsc::Receiver<(u32, u32)>,
    on_data: &Channel<Response>,
) -> i32 {
    loop {
        tokio::select! {
            Some(data) = input_rx.recv() => {
                if channel.data(data.as_ref()).await.is_err() {
                    return 1;
                }
            }
            Some((cols, rows)) = resize_rx.recv() => {
                let _ = channel.window_change(cols, rows, 0, 0).await;
            }
            Some(msg) = channel.wait() => {
                match msg {
                    ChannelMsg::Data { data } => {
                        let bytes: Vec<u8> = data.to_vec();
                        if on_data.send(Response::new(bytes)).is_err() {
                            return 1;
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => {
                        return exit_status as i32;
                    }
                    ChannelMsg::Eof => {
                        return 0;
                    }
                    _ => {}
                }
            }
            else => return 1,
        }
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

#[tauri::command]
pub fn ssh_close(state: tauri::State<'_, SshState>, id: u32) -> Result<(), String> {
    state.sessions.write().unwrap().remove(&id);
    Ok(())
}
