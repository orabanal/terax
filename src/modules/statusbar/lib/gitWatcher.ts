import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Event-driven remote git state (replaces SSH polling).
 *
 * Instead of opening 1-2 exec channels per poll cycle (each paying channel
 * setup + shell fork + `ps` scans + IPC + React), one tiny daemon per SSH
 * session watches the interactive shell's git state from *inside* the
 * server and appends a line to `~/.terax-git-events.jsonl` only when
 * something changes. We tail that file with the existing `ssh_tail_*`
 * machinery. Frontend cost per change: one setState. Server cost per 5s
 * tick: a few local forks, zero channels, zero IPC.
 *
 * Non-Linux remotes (no /proc): the daemon emits empty-cwd lines and the
 * chip behaves exactly like today's fallback (blank). Nothing regresses.
 */

const GIT_EVENTS_FILE = ".terax-git-events.jsonl";
const WATCH_SCRIPT_PREFIX = ".terax-git-watch-";
const POLL_TICK_S = 5;

// Unit separator (0x1F): never appears in paths/branch names, unlike | or spaces.
const SEP = "\x1f";

function daemonScript(): string {
  return [
    // $1 = pid of the connection sshd, baked at install time. The daemon
    // outlives its installer channel (nohup), so a runtime $PPID would be
    // stale (reparented to init) and the ps-sibling search would find
    // nothing forever. The sshd pid stays valid for the whole connection.
    'TERAX_SSHD="$1"',
    'TERAX_TOK="__TERAX_TOKEN__"',
    'TERAX_EF="$HOME/.terax-git-events.jsonl"',
    'TERAX_LAST="__init__"',
    "while true; do",
    // Self-exit when the connection sshd is gone (transport drop, server
    // reboot): the frontend cannot deliver a kill through a dead session,
    // so without this every disconnect orphans one idle loop per tab.
    // (A recycled pid keeps a harmless emitter of empty lines at worst —
    // the token still scopes every line to this dead session.)
    '  kill -0 "$TERAX_SSHD" 2>/dev/null || exit 0',
    // Same shell-sibling CWD detection the probes used (Linux /proc).
    "  TERAX_P=$(ps --ppid $TERAX_SSHD -o pid=,comm= 2>/dev/null | awk -v self=$$ '$1!=self && $2~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}')",
    '  if [ -z "$TERAX_P" ]; then',
    "    TERAX_P=$(ps -e -o pid=,ppid=,comm= 2>/dev/null | awk -v pp=$TERAX_SSHD -v self=$$ '$1!=self && $2==pp && $3~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}')",
    "  fi",
    '  TERAX_D=""',
    '  if [ -n "$TERAX_P" ]; then',
    "    TERAX_D=$(readlink /proc/$TERAX_P/cwd 2>/dev/null)",
    "  fi",
    '  TERAX_B=""',
    '  TERAX_S=""',
    '  if [ -n "$TERAX_D" ] && git -C "$TERAX_D" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '    TERAX_B=$(git -C "$TERAX_D" symbolic-ref --short HEAD 2>/dev/null || git -C "$TERAX_D" rev-parse --short HEAD 2>/dev/null)',
    '    TERAX_S=$(git -C "$TERAX_D" diff --shortstat HEAD 2>/dev/null)',
    "  fi",
    '  TERAX_CUR="$TERAX_D|$TERAX_B|$TERAX_S"',
    '  if [ "$TERAX_CUR" != "$TERAX_LAST" ]; then',
    // Single printf = single write(2): O_APPEND lines never interleave
    // even with several daemons sharing the events file.
    `    printf 'GIT\\037%s\\037%s\\037%s\\037%s\\n' "$TERAX_TOK" "$TERAX_D" "$TERAX_B" "$TERAX_S" >> "$TERAX_EF"`,
    '    TERAX_LAST="$TERAX_CUR"',
    "  fi",
    `  sleep ${POLL_TICK_S}`,
    "done",
  ].join("\n");
}

export type GitWatchEvent = {
  sshId: number;
  cwd: string | null;
  branch: string | null;
  /** Raw `git diff --shortstat` output (may be ""). */
  shortstat: string;
};

/** Parse one daemon line for our token. Null for anything else
 *  (other tokens, opencode lines, torn lines). */
export function parseGitEventLine(
  line: string,
  sshId: number,
): GitWatchEvent | null {
  if (!line.startsWith(`GIT${SEP}`)) return null;
  const parts = line.split(SEP);
  if (parts.length !== 5) return null;
  const [, tok, cwd, branch, shortstat] = parts;
  if (tok !== String(sshId)) return null;
  return {
    sshId,
    cwd: cwd ? cwd : null,
    branch: branch ? branch : null,
    shortstat: shortstat ?? "",
  };
}

type WatcherRecord = {
  tailId: number;
  pid: number;
  /** Disambiguates script files across app instances (both start sshIds
   *  at 1): without it, a second Terax window would overwrite + break the
   *  first window's running daemon mid-loop. */
  nonce: string;
  buffer: string;
};

const watchers = new Map<number, WatcherRecord>();
const firstEventAt = new Map<number, number>();
const firstCwdAt = new Map<number, number>();
let tailListenerInstalled = false;
let tailListenerLive = false;

async function ensureTailListener(): Promise<void> {
  if (tailListenerInstalled) return;
  tailListenerInstalled = true;
  // No-op outside the webview (unit tests): chunk routing only matters live.
  if (typeof window === "undefined") return;
  // NOTE: backend Tauri events arrive via `listen()`, NOT window events —
  // subscribing on window here silently drops every chunk (the bug that
  // blanked the chip).
  try {
    await listen<{ sshId: number; chunk: string }>(
      "terax:opencode-tail",
      (e) => {
        const { sshId, chunk } = e.payload;
        const rec = watchers.get(sshId);
        if (!rec) return;
        rec.buffer += chunk;
        const lines = rec.buffer.split("\n");
        rec.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const ev = parseGitEventLine(line, sshId);
          if (!ev) continue;
          if (!firstEventAt.has(sshId)) firstEventAt.set(sshId, Date.now());
          if (ev.cwd && !firstCwdAt.has(sshId)) firstCwdAt.set(sshId, Date.now());
          window.dispatchEvent(
            new CustomEvent<GitWatchEvent>("terax:git-event", {
              detail: ev,
            }),
          );
        }
      },
    );
    tailListenerLive = true;
  } catch {
    /* non-Tauri runtime */
  }
}

function scriptPath(sshId: number, nonce: string): string {
  return `$HOME/${WATCH_SCRIPT_PREFIX}${sshId}-${nonce}.sh`;
}

/** Full install+launch one-liner for `ssh_exec`. Exported for tests:
 *  token substituted, heredoc quoted (no local expansion), sshd pid baked
 *  as argv (the daemon outlives its installer, so runtime $PPID is stale),
 *  daemon pid echoed. */
export function buildWatcherInstall(sshId: number, nonce: string): string {
  const script = daemonScript().split("__TERAX_TOKEN__").join(String(sshId));
  return `cat > "${scriptPath(sshId, nonce)}" <<'TERAX_GIT_WATCH_EOF'\n${script}\nTERAX_GIT_WATCH_EOF\nnohup sh "${scriptPath(sshId, nonce)}" "$PPID" >/dev/null 2>&1 & echo $!`;
}

/** Kill + script-removal one-liner. The /proc cmdline guard keeps a
 *  recycled pid from killing an unrelated process: without /proc the
 *  guard can't run, so plain kill is the fallback (daemon hosts are
 *  Linux in practice). Always exits 0. */
export function buildWatcherKill(
  sshId: number,
  nonce: string,
  pid: number,
): string {
  const script = scriptPath(sshId, nonce);
  return [
    `TERAX_PID=${pid}`,
    `if [ -d "/proc/$TERAX_PID" ]; then`,
    `  if grep -q "terax-git-watch" "/proc/$TERAX_PID/cmdline" 2>/dev/null; then kill $TERAX_PID 2>/dev/null; fi`,
    `else`,
    `  kill $TERAX_PID 2>/dev/null`,
    `fi`,
    `rm -f "${script}"; true`,
  ].join("\n");
}

/** How long to wait for the daemon's first cwd-bearing line before
 *  declaring the pipe broken and falling back to polls. Healthy daemons
 *  emit on iteration one (~1s); this only bites on broken remotes. */
const WATCHER_PROVE_MS = 6_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Start the daemon + tail for `sshId`. Idempotent. False when the remote
 *  cannot run it (non-POSIX sshd, install failed, or no cwd-bearing line
 *  within budget) — caller falls back to legacy polling. Install and tail
 *  launch concurrently (independent: `tail -F` waits for the file); any
 *  partial success is cleaned up before reporting failure. */
export async function ensureGitWatcher(sshId: number): Promise<boolean> {
  if (watchers.has(sshId)) return true;
  await ensureTailListener();
  const nonce = Math.floor(Math.random() * 0x7fffffff).toString(36);
  let pid = NaN;
  let tailId: number | null = null;
  // allSettled (not all): on partial failure we still learn the pid and
  // the tail id, so the cleanup below can close whatever half opened.
  const [installRes, tailRes] = await Promise.allSettled([
    invoke<{ stdout: string }>("ssh_exec", {
      id: sshId,
      command: buildWatcherInstall(sshId, nonce),
    }),
    invoke<number>("ssh_tail_start", {
      id: sshId,
      path: `~/${GIT_EVENTS_FILE}`,
    }),
  ]);
  try {
    if (installRes.status === "fulfilled") {
      pid = parseInt(
        installRes.value.stdout.trim().split(/\s+/).pop() ?? "",
        10,
      );
    }
    if (tailRes.status === "fulfilled") tailId = tailRes.value;
    if (!Number.isFinite(pid) || pid <= 0 || tailId === null) {
      throw new Error("watcher half-open");
    }
  } catch {
    // One side opened without the other: close it before reporting failure,
    // otherwise a daemon runs forever with nobody reading its lines.
    if (tailId !== null) {
      try {
        await invoke("ssh_tail_stop", { tailId });
      } catch {
        /* already gone */
      }
    }
    if (Number.isFinite(pid) && pid > 0) {
      try {
        await invoke("ssh_exec", {
          id: sshId,
          command: buildWatcherKill(sshId, nonce, pid),
        });
      } catch {
        /* session dead; daemon self-exits with its sshd */
      }
    }
    return false;
  }
  watchers.set(sshId, { tailId, pid, nonce, buffer: "" });
  // Fail fast: a daemon that never proves cwd detection is broken for
  // our purposes (dead on arrival, missing /proc). Tear it down now so
  // the caller polls immediately instead of lingering on the 15s
  // silent-pipe guard. Skipped where chunk routing can't run (unit tests)
  // — install+tail success is proof enough there.
  if (tailListenerLive) {
    const deadline = Date.now() + WATCHER_PROVE_MS;
    while (firstCwdAt.get(sshId) == null && Date.now() < deadline) {
      await sleep(250);
    }
    if (firstCwdAt.get(sshId) == null) {
      await stopGitWatcher(sshId);
      return false;
    }
  }
  return true;
}

/** Epoch ms of the first routed event, or null if none arrived yet. */
export function gitWatcherFirstEventAt(sshId: number): number | null {
  return firstEventAt.get(sshId) ?? null;
}

/** Stop the tail (channel closed backend-side) and kill the daemon.
 *  Best-effort: a dead session fails both invokes. A daemon whose session
 *  died without a stop self-exits via its sshd liveness check, so orphans
 *  are bounded by one sleep tick, not forever. */
export async function stopGitWatcher(sshId: number): Promise<void> {
  const rec = watchers.get(sshId);
  if (!rec) return;
  watchers.delete(sshId);
  firstEventAt.delete(sshId);
  firstCwdAt.delete(sshId);
  try {
    await invoke("ssh_tail_stop", { tailId: rec.tailId });
  } catch {
    /* channel already gone */
  }
  try {
    await invoke("ssh_exec", {
      id: sshId,
      command: buildWatcherKill(sshId, rec.nonce, rec.pid),
    });
  } catch {
    /* session dead — daemon self-exits with its sshd */
  }
}
