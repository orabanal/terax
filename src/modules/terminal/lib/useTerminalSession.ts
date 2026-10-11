import { invoke } from "@tauri-apps/api/core";
import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { probeRemoteOs } from "@/modules/os-icon";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshHost } from "@/modules/ssh/store";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DormantRing } from "./dormantRing";
import {
  perfRecordBytes,
  perfRecordWrite,
  perfSample,
  perfStartFramePump,
} from "./perfHud";
import type { BlockMode } from "../block/lib/modeMachine";
import {
  createShellIntegrationState,
  registerCwdHandler,
  registerPromptTracker,
  registerOsc52ClipboardHandler,
} from "./osc-handlers";
import { openPty, openSshPty, type PtySession } from "./pty-bridge";
import { BlockDecorations } from "../block/lib/blockDecorations";
import "../block/block.css";
import {
  acquireSlot,
  applyBackgroundActive,
  applyCursorBlink,
  applyCursorStyle,
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyTheme as applyPoolTheme,
  applyScrollback,
  applySmoothScroll,
  applyWebglPreference,
  clearLeaf,
  configureRendererPool,
  copyFromLeaf,
  disposeLeafSlot,
  focusSlot,
  getSlotForLeaf,
  isLeafAltScreen,
  parkLeafSlot,
  pasteClipboardToLeaf,
  pasteIntoLeaf,
  pasteSelectionToLeaf,
  poolSize,
  poolSlotStats,
  refreshLeafSlot,
  releaseSlot,
  selectAllInLeaf,
  setSlotFocused,
} from "./rendererPool";

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

type Session = {
  pty: PtySession | null;
  ptyOpening: boolean;
  initialCwd: string | undefined;
  command: string[] | undefined;
  sshHost: (SshHost & { password?: string }) | undefined;
  lastCwd: string | null;
  pendingExit: number | null;
  /** Incarnation counter: every fresh PTY open bumps it, so callbacks
   *  captured by a dead incarnation (late onData/onExit after respawn or
   *  close) are dropped instead of bleeding into the new session. */
  gen: number;
  /** Backend SSH session id. Survives `pty === null` windows (reconnect /
   *  respawn) so polls and notifications keep routing to the logical
   *  session instead of dropping events; null for local leaves. */
  sshId: number | null;
  shellExited: boolean;
  /** SSH transport dropped (keepalive timeout / TCP failure), not a clean exit. */
  sshDisconnected: boolean;
  callbacks: Callbacks;
  visibleNow: boolean;
  focusedNow: boolean;
  disposed: boolean;
  ready: Promise<void>;
  cols: number;
  rows: number;
  container: HTMLDivElement | null;
  snapshot: string | null;
  searchQuery: string | null;
  /** Last `terax:ssh-activity` emit (performance.now), for throttling. */
  lastActivityEmit: number;
  dormantRing: DormantRing;
  pendingInput: string;
  hasSlot: boolean;
  blocks: boolean;
  blockMode: BlockMode;
  blockListeners: Set<() => void>;
  blockDecorations: BlockDecorations | null;
  altScreenAtRelease: boolean;
};

const sessions = new Map<number, Session>();

// SSH status subscribers keyed by leafId. Multi-subscriber: the reconnect
// modal and per-pane indicators listen to the same leaf without clobbering.
const sshStatusListeners = new Map<number, Set<(msg: string) => void>>();

export function subscribeSshStatus(
  leafId: number,
  cb: (msg: string) => void,
): () => void {
  let set = sshStatusListeners.get(leafId);
  if (!set) {
    set = new Set();
    sshStatusListeners.set(leafId, set);
  }
  set.add(cb);
  return () => {
    const s = sshStatusListeners.get(leafId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) sshStatusListeners.delete(leafId);
  };
}

function emitSshStatus(leafId: number, msg: string): void {
  sshStatusListeners.get(leafId)?.forEach((cb) => {
    cb(msg);
  });
}

export function getCwdForLeaf(leafId: number): string | null {
  return sessions.get(leafId)?.lastCwd ?? null;
}

/** Connection identity of a leaf's session: SSH host id, baked-in command,
 *  or local. Unknown (not yet mounted) leaves read as local. Used to detect
 *  mixed-connection tabs ("Workspace"). */
export function getLeafConnectionKey(leafId: number): string {
  const s = sessions.get(leafId);
  if (!s) return "local";
  if (s.sshHost) return `ssh:${s.sshHost.id}`;
  if (s.command && s.command.length > 0) return `cmd:${s.command.join(" ")}`;
  return "local";
}

/** Live connection config of a leaf's session (null when not mounted).
 *  Source of truth when a pane moves between tabs: the destination tab's
 *  own sshHost/command may belong to a different connection. */
export function getLeafSessionConfig(leafId: number): {
  sshHost: (SshHost & { password?: string }) | undefined;
  command: string[] | undefined;
} | null {
  const s = sessions.get(leafId);
  if (!s) return null;
  return { sshHost: s.sshHost ?? undefined, command: s.command };
}

/** Pre-register a session record for a fresh leaf id inheriting another
 *  leaf's connection (SSH host / command) and cwd — used by split and
 *  clone so the new pane dials the source's connection instead of the
 *  tab-level defaults (which lose mixed local + SSH workspaces).
 *  No PTY is opened here — the mount's `ensureSession` finds this record and
 *  `openPtyForSession` dials the inherited connection. */
export function seedLeafSession(
  leafId: number,
  opts: {
    initialCwd?: string;
    command?: string[];
    sshHost?: SshHost & { password?: string };
  },
): void {
  ensureSession(leafId, opts.initialCwd, false, opts.command, opts.sshHost);
}

/** Returns true if the session for `leafId` already has an active PTY. */
export function isSessionConnected(leafId: number): boolean {
  return !!sessions.get(leafId)?.pty;
}

/** Backend SSH id of a live interactive session for `hostId`, if any.
 *  Lets SFTP multiplex on the existing transport (M3) instead of paying
 *  a second TCP handshake + auth. Prefers connected leaves; skips dead or
 *  disposing records. */
export function findLiveSshSessionForHost(hostId: string): number | null {
  for (const [, s] of sessions) {
    if (s.disposed || s.shellExited || s.sshDisconnected) continue;
    if (s.sshHost?.id !== hostId) continue;
    const id = s.sshId ?? s.pty?.id ?? null;
    if (id !== null) return id;
  }
  return null;
}

const SSH_EXIT_CONNECTION_LOST = -1;

/** True if the SSH transport dropped unexpectedly (not a clean shell exit). */
export function isSshDisconnected(leafId: number): boolean {
  return sessions.get(leafId)?.sshDisconnected ?? false;
}

/** Clear the disconnect flag (user dismissed the reconnect modal). */
export function clearSshDisconnected(leafId: number): void {
  const s = sessions.get(leafId);
  if (s) s.sshDisconnected = false;
}

const readyLeaves = new Set<number>();
const readyWaiters = new Map<
  number,
  { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]
>();

function markSessionReady(leafId: number): void {
  if (readyLeaves.has(leafId)) return;
  readyLeaves.add(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

export function whenSessionReady(leafId: number, timeoutMs = 4000): Promise<void> {
  if (readyLeaves.has(leafId)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const arr = readyWaiters.get(leafId);
      const i = arr?.findIndex((w) => w.timer === timer) ?? -1;
      if (arr && i >= 0) arr.splice(i, 1);
      resolve();
    }, timeoutMs);
    const arr = readyWaiters.get(leafId) ?? [];
    arr.push({ resolve, timer });
    readyWaiters.set(leafId, arr);
  });
}

export { focusSlot, copyFromLeaf, pasteIntoLeaf, pasteClipboardToLeaf, pasteSelectionToLeaf, selectAllInLeaf, clearLeaf };

export function writeToSession(leafId: number, data: string): boolean {
  const s = sessions.get(leafId);
  if (!s || s.shellExited) return false;
  if (s.pty) {
    s.pty.write(data).catch((e) => reportWriteFailure(leafId, e));
    return true;
  }
  s.pendingInput += data;
  return true;
}

/**
 * Clear the scrollback and screen of the currently focused terminal, keeping
 * the active prompt line — macOS Terminal's ⌘K behaviour. Returns false when no
 * focused terminal slot is bound (e.g. focus is in the editor or AI panel).
 */
export function clearFocusedTerminal(): boolean {
  for (const [leafId, s] of sessions) {
    if (!s.visibleNow || !s.focusedNow) continue;
    const slot = getSlotForLeaf(leafId);
    if (!slot) continue;
    slot.term.clear();
    return true;
  }
  return false;
}

export function leafIdForPty(ptyId: number): number | null {
  for (const [leafId, s] of sessions) {
    if (s.pty?.id === ptyId) return leafId;
  }
  return null;
}

/** Get the SSH session id for a terminal leaf. Returns null when the leaf
 *  is unknown or local. Uses the persistent record id (not the live PTY
 *  handle) so lookups survive reconnect/respawn windows where `pty` is
 *  briefly null; execs against a dead id fail fast backend-side and the
 *  callers already retry. */
export function ptyIdForLeaf(leafId: number): number | null {
  const s = sessions.get(leafId);
  if (!s?.sshHost) return null;
  return s.sshId ?? s.pty?.id ?? null;
}

/** Write-side failure surface: ssh_write rejects when the session is gone
 *  or backpressured (M5). Callers already treat false/theme as best-effort;
 *  this makes the loss visible instead of a floating rejection. */
function reportWriteFailure(leafId: number, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`[terax] write to leaf ${leafId} failed:`, message);
  window.dispatchEvent(
    new CustomEvent<{ leafId: number; message: string }>("terax:ssh-write-failed", {
      detail: { leafId, message },
    }),
  );
}

export type TerminalOpenError = {
  leafId: number;
  message: string;
};

/** Surface PTY open failures to the pane (local opens fail silently
 *  otherwise — a black terminal with no explanation). Listened by
 *  TerminalPane, which offers a retry. */
function emitTerminalOpenError(leafId: number, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  window.dispatchEvent(
    new CustomEvent<TerminalOpenError>("terax:terminal-open-failed", {
      detail: { leafId, message },
    }),
  );
}

configureRendererPool({
  resolveLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    return {
      writeToPty: (data) => {
        s.pty?.write(data)?.catch((e) => reportWriteFailure(leafId, e));
      },
      resizePty: (cols, rows) => {
        s.cols = cols;
        s.rows = rows;
        s.pty?.resize(cols, rows);
      },
      kickPty: (cols, rows) => {
        const pty = s.pty;
        if (!pty || cols <= 0 || rows <= 0) return;
        // Linux only emits SIGWINCH when the winsize ioctl actually
        // changes dims, so bump +1 row then restore. The TUI receives
        // (possibly two) SIGWINCHes and repaints from scratch.
        pty
          .resize(cols, rows + 1)
          .then(() => pty.resize(cols, rows))
          .catch((e) => console.warn("[terax] kickPty failed:", e));
      },
    };
  },
  evictLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return;
    unbindLeafFromSlot(leafId, s);
  },
  isLeafFocused(leafId) {
    const s = sessions.get(leafId);
    return !!s && s.visibleNow && s.focusedNow;
  },
});

function ensureSession(
  leafId: number,
  initialCwd?: string,
  blocks = false,
  command?: string[],
  sshHost?: SshHost & { password?: string },
): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const session: Session = {
    pty: null,
    ptyOpening: false,
    initialCwd,
    command,
    sshHost,
    lastCwd: null,
    pendingExit: null,
    gen: 0,
    sshId: null,
    shellExited: false,
    sshDisconnected: false,
    callbacks: {},
    visibleNow: false,
    focusedNow: false,
    disposed: false,
    ready: Promise.resolve(),
    cols: 0,
    rows: 0,
    container: null,
    snapshot: null,
    searchQuery: null,
    lastActivityEmit: 0,
    dormantRing: new DormantRing(),
    pendingInput: "",
    hasSlot: false,
    blocks,
    blockMode: "prompt",
    blockListeners: new Set(),
    blockDecorations: null,
    altScreenAtRelease: false,
  };
  sessions.set(leafId, session);

  session.ready = (async () => {
    const userFont = usePreferencesStore.getState().terminalFontFamily || undefined;
    await ensureMonoFontsLoaded(userFont);
    await document.fonts.ready;
  })();

  return session;
}

/**
 * Output coalescing: SSH delivers data as TCP segments arrive (often a few
 * hundred bytes), and each IPC chunk used to become its own `term.write()`
 * — hundreds of parse/render schedulings per second while an agent streams,
 * which is the scroll stutter vs native terminals. Now visible leaves
 * accumulate chunks and flush once per animation frame as a single write;
 * hidden leaves keep pushing straight into the dormant ring.
 */
type PendingFlush = {
  chunks: Uint8Array[];
  total: number;
  raf: number | null;
};

const pendingWrites = new Map<number, PendingFlush>();

/** Single write cap — bounds memory when rAF is paused (e.g. minimized
 *  window) by flushing synchronously past this size, and bounds the worst
 *  single `term.write()` on the UI thread: oversized writes mid-burst
 *  freeze scrolling for hundreds of ms (worse with contrast recalc under
 *  a background image). */
const COALESCE_FLUSH_CAP = 64 * 1024;

/** `terax:ssh-activity` is consumed for connect detection and debounced
 *  refreshes/scans — none of it needs per-chunk granularity. */
const SSH_ACTIVITY_THROTTLE_MS = 1000;

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array(0);
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Write any queued bytes now (ordering preserved). Called on rAF, and
 *  synchronously before unbind/serialize so no byte is lost from snapshots. */
function flushPendingLeafBytes(leafId: number): void {
  const p = pendingWrites.get(leafId);
  if (!p) return;
  if (p.raf !== null) {
    cancelAnimationFrame(p.raf);
    p.raf = null;
  }
  if (p.total === 0) {
    pendingWrites.delete(leafId);
    return;
  }
  const combined = concatChunks(p.chunks);
  pendingWrites.delete(leafId);
  const s = sessions.get(leafId);
  if (!s) return;
  const slot = getSlotForLeaf(leafId);
  if (slot) {
    slot.term.write(combined);
    perfRecordWrite();
  } else {
    s.dormantRing.push(combined);
  }
}

/** Drop queued bytes (session teardown / respawn cleared the screen). */
function cancelPendingLeafBytes(leafId: number): void {
  const p = pendingWrites.get(leafId);
  if (!p) return;
  if (p.raf !== null) cancelAnimationFrame(p.raf);
  pendingWrites.delete(leafId);
}

function deliverPtyBytes(leafId: number, bytes: Uint8Array): void {
  const s = sessions.get(leafId);
  if (!s) return;
  perfRecordBytes(bytes.byteLength);
  const slot = getSlotForLeaf(leafId);
  if (!slot) {
    s.dormantRing.push(bytes);
  } else {
    let p = pendingWrites.get(leafId);
    if (!p) {
      p = { chunks: [], total: 0, raf: null };
      pendingWrites.set(leafId, p);
    }
    p.chunks.push(bytes);
    p.total += bytes.byteLength;
    if (p.total >= COALESCE_FLUSH_CAP) {
      flushPendingLeafBytes(leafId);
    } else if (p.raf === null) {
      p.raf = requestAnimationFrame(() => flushPendingLeafBytes(leafId));
    }
  }
  if (s.sshHost) {
    const now = performance.now();
    if (now - s.lastActivityEmit >= SSH_ACTIVITY_THROTTLE_MS) {
      s.lastActivityEmit = now;
      window.dispatchEvent(new CustomEvent("terax:ssh-activity", { detail: { leafId } }));
    }
  }
}

async function openPtyForSession(
  leafId: number,
  s: Session,
  cwd: string | undefined,
): Promise<PtySession> {
  const startCols = s.cols > 0 ? s.cols : 80;
  const startRows = s.rows > 0 ? s.rows : 24;

  // New incarnation: callbacks captured below belong to THIS open only.
  // Late events from a previous incarnation (close/respawn/dispose race)
  // fail the check and are dropped instead of bleeding across sessions.
  s.gen += 1;
  const gen = s.gen;
  const ifCurrent = (fn: () => void) => {
    const cur = sessions.get(leafId);
    if (cur === s && !cur.disposed && cur.gen === gen) fn();
  };
  const onData = (bytes: Uint8Array) =>
    ifCurrent(() => deliverPtyBytes(leafId, bytes));
  const onExit = (code: number) =>
    ifCurrent(() => {
      s.shellExited = true;
      s.pty = null;
      s.pendingInput = "";
      const slot = getSlotForLeaf(leafId);
      if (slot) slot.term.options.disableStdin = true;
      if (code === SSH_EXIT_CONNECTION_LOST) {
        // Transport died (keepalive timeout, TCP reset). Surface the
        // reconnect modal regardless of whether it is currently mounted;
        // do not treat this as a shell exit.
        s.sshDisconnected = true;
        emitSshStatus(leafId, "Disconnected");
        // Emit event for reactive UI updates (replaces polling)
        window.dispatchEvent(
          new CustomEvent("terax:ssh-activity", { detail: { leafId } })
        );
        return;
      }
      if (s.callbacks.onExit) s.callbacks.onExit(code);
      else s.pendingExit = code;
    });

  if (s.sshHost) {
    const host = s.sshHost;
    return openSshPty(startCols, startRows, host, host.password, {
      onConnected: (sshId) => ifCurrent(() => probeRemoteOs(host.id, sshId)),
      onData,
      onExit,
      onStatus: (msg) =>
        ifCurrent(() => {
          emitSshStatus(leafId, msg);
          // Emit event on status changes for reactive updates
          window.dispatchEvent(
            new CustomEvent("terax:ssh-activity", { detail: { leafId } })
          );
        }),
    }, cwd);
  }

  return openPty(
    startCols,
    startRows,
    { onData, onExit },
    cwd,
    s.blocks,
    s.command,
  );
}

function applyBlockMode(leafId: number, mode: BlockMode): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.blockMode = mode;
  const slot = getSlotForLeaf(leafId);
  if (slot) {
    slot.term.options.disableStdin = mode === "prompt";
    if (mode !== "prompt") slot.term.focus();
  }
  for (const l of s.blockListeners) l();
}

function bindLeafToSlot(leafId: number, s: Session): void {
  if (!s.container) return;
  const altScreen = s.altScreenAtRelease;
  s.altScreenAtRelease = false;
  acquireSlot({
    leafId,
    container: s.container,
    snapshot: s.snapshot,
    altScreen,
    drainRing: (write) => s.dormantRing.drain(write),
    shellExited: s.shellExited,
    searchQuery: s.searchQuery,
    cols: s.cols,
    rows: s.rows,
    registerOsc: (term) => {
      if (s.blocks) {
        const deco = new BlockDecorations(term, {
          onCwd: (next) => {
            markSessionReady(leafId);
            if (s.lastCwd === next) return;
            s.lastCwd = next;
            s.callbacks.onCwd?.(next);
          },
          onMode: (mode) => applyBlockMode(leafId, mode),
        });
        s.blockDecorations = deco;
        const disposeClipboard = registerOsc52ClipboardHandler(term);
        return [
          () => {
            s.blockDecorations = null;
            deco.dispose();
          },
          disposeClipboard,
        ];
      }
      // Shared in-command flag — see osc-handlers.ts. The prompt tracker
      // flips it on OSC 133 B/C/D/A; the cwd handler reads it to ignore OSC
      // 7 emitted by untrusted command output (remote SSH, `cat` of an
      // attacker file, etc.).
      const shellState = createShellIntegrationState();
      const prompt = registerPromptTracker(term, shellState);
      const cwd = registerCwdHandler(
        term,
        (next) => {
          markSessionReady(leafId);
          if (s.lastCwd === next) return;
          s.lastCwd = next;
          s.callbacks.onCwd?.(next);
        },
        shellState,
      );
      const disposeClipboard = registerOsc52ClipboardHandler(term);
      return [prompt.dispose, cwd, disposeClipboard];
    },
    onSearchReady: (addon) => s.callbacks.onSearchReady?.(addon),
  });
  s.snapshot = null;
  s.hasSlot = true;
  if (s.blocks) applyBlockMode(leafId, s.blockMode);
  if (s.lastCwd !== null) s.callbacks.onCwd?.(s.lastCwd);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    s.callbacks.onExit?.(code);
  }
}

function unbindLeafFromSlot(leafId: number, s: Session): void {
  if (!s.hasSlot) return;
  // Write coalesced bytes into the terminal BEFORE serialize, otherwise
  // they would be missing from both the snapshot and the dormant ring.
  flushPendingLeafBytes(leafId);
  const out = releaseSlot(leafId);
  if (out) {
    s.snapshot = out.snapshot;
    if (out.cols > 0) s.cols = out.cols;
    if (out.rows > 0) s.rows = out.rows;
    s.altScreenAtRelease = out.altScreen;
  }
  s.hasSlot = false;
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: Callbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;
  s.container = container;

  if (s.visibleNow) bindLeafToSlot(leafId, s);

  if (!s.pty && !s.ptyOpening && !s.shellExited) {
    s.ptyOpening = true;
    openPtyForSession(leafId, s, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed) {
          pty.close();
          return;
        }
        s.pty = pty;
        // M6: record the backend SSH id so polls/notifications route by
        // logical session, not by live handle (survives pty-null windows).
        if (s.sshHost) s.sshId = pty.id;
        if (s.pendingInput) {
          pty.write(s.pendingInput).catch((e) => reportWriteFailure(leafId, e));
          s.pendingInput = "";
        }
        if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("[terax] openPty failed:", e);
        emitTerminalOpenError(leafId, e);
      });
  }
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  unbindLeafFromSlot(leafId, s);
  s.callbacks = {};
  s.container = null;
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.pty?.close();
  s.pty = null;
  s.snapshot = null;
  s.dormantRing = new DormantRing();
  s.shellExited = false;
  s.sshDisconnected = false;
  s.pendingExit = null;
  s.altScreenAtRelease = false;

  const slot = getSlotForLeaf(leafId);
  if (slot) {
    slot.term.options.disableStdin = false;
    slot.term.clear();
    slot.term.reset();
  }
  // The screen was wiped — queued bytes belong to the previous incarnation.
  cancelPendingLeafBytes(leafId);

  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyForSession(leafId, s, cwd ?? s.initialCwd);
  } catch (e) {
    s.ptyOpening = false;
    console.error("[terax] respawn openPty failed:", e);
    emitTerminalOpenError(leafId, e);
    return;
  }
  s.ptyOpening = false;
  if (s.disposed) {
    pty.close();
    return;
  }
  s.pty = pty;
  if (s.sshHost) s.sshId = pty.id;
  if (s.pendingInput) {
    pty.write(s.pendingInput).catch((e) => reportWriteFailure(leafId, e));
    s.pendingInput = "";
  }
  if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
}

export async function leafHasForegroundProcess(leafId: number): Promise<boolean> {
  const s = sessions.get(leafId);
  if (!s?.pty || s.shellExited) return false;
  try {
    const result = await invoke<boolean>("pty_has_foreground_process", { id: s.pty.id });
    return result;
  } catch (e) {
    console.error("[terax] pty_has_foreground_process failed for leaf", leafId, e);
    return false;
  }
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  cancelPendingLeafBytes(leafId);
  s.disposed = true;
  disposeLeafSlot(leafId);
  s.hasSlot = false;
  s.snapshot = null;
  s.pty?.close();
  s.pty = null;
  s.pendingInput = "";
  sessions.delete(leafId);
  readyLeaves.delete(leafId);
  const waiters = readyWaiters.get(leafId);
  if (waiters) {
    readyWaiters.delete(leafId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }
}

type Options = {
  leafId: number;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused?: boolean;
  initialCwd?: string;
  blocks?: boolean;
  command?: string[];
  sshHost?: SshHost & { password?: string };
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

export function useTerminalSession({
  leafId,
  container,
  visible,
  focused = true,
  initialCwd,
  blocks = false,
  command,
  sshHost,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const cbRef = useRef({ onSearchReady, onExit, onCwd });
  cbRef.current = { onSearchReady, onExit, onCwd };

  useEffect(() => {
    let cancelled = false;
    const s = ensureSession(leafId, initialCwd, blocks, command, sshHost);
    s.ready.then(() => {
      if (cancelled || s.disposed) return;
      const node = container.current;
      if (!node) return;
      attachSession(leafId, node, {
        onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
        onExit: (c) => cbRef.current.onExit?.(c),
        onCwd: (c) => cbRef.current.onCwd?.(c),
      });
      if (s.visibleNow && s.focusedNow && !s.blocks) focusSlot(leafId);
    });
    return () => {
      cancelled = true;
      detachSession(leafId);
    };
  }, [leafId, container, initialCwd, blocks, command, sshHost]);

  const [blockMode, setBlockMode] = useState<BlockMode>("prompt");
  useEffect(() => {
    if (!blocks) return;
    const s = ensureSession(leafId, initialCwd, blocks, command, sshHost);
    setBlockMode(s.blockMode);
    const cb = () => setBlockMode(sessions.get(leafId)?.blockMode ?? "prompt");
    s.blockListeners.add(cb);
    return () => {
      s.blockListeners.delete(cb);
    };
  }, [leafId, blocks, initialCwd, sshHost, command]);

  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const zoomLevel = usePreferencesStore((p) => p.zoomLevel);
  useEffect(() => {
    applyFontSize(Math.max(4, Math.round(fontSize * zoomLevel)));
  }, [fontSize, zoomLevel]);

  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  useEffect(() => {
    applyFontFamily(fontFamily);
  }, [fontFamily]);

  const letterSpacing = usePreferencesStore((p) => p.terminalLetterSpacing);
  useEffect(() => {
    applyLetterSpacing(letterSpacing);
  }, [letterSpacing]);

  const scrollback = usePreferencesStore((p) => p.terminalScrollback);
  useEffect(() => {
    applyScrollback(scrollback);
  }, [scrollback]);

  const smoothScroll = usePreferencesStore((p) => p.terminalSmoothScroll);
  useEffect(() => {
    applySmoothScroll(smoothScroll);
  }, [smoothScroll]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    applyWebglPreference(webglPref);
  }, [webglPref]);

  const cursorBlink = usePreferencesStore((p) => p.terminalCursorBlink);
  useEffect(() => {
    applyCursorBlink(cursorBlink);
  }, [cursorBlink]);

  const cursorStyle = usePreferencesStore((p) => p.terminalCursorStyle);
  useEffect(() => {
    applyCursorStyle(cursorStyle ?? "bar");
  }, [cursorStyle]);

  const bgActive = usePreferencesStore(
    (p) => p.backgroundKind === "image" && !!p.backgroundImageId,
  );
  useEffect(() => {
    applyBackgroundActive(bgActive);
  }, [bgActive]);

  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.visibleNow = visible;
    s.focusedNow = focused;
    if (visible) {
      if (s.container && !s.hasSlot) bindLeafToSlot(leafId, s);
      else if (s.hasSlot) refreshLeafSlot(leafId);
      setSlotFocused(leafId, focused);
      if (focused && !blocks) focusSlot(leafId);
    } else if (s.hasSlot) {
      if (s.blocks || isLeafAltScreen(leafId)) parkLeafSlot(leafId);
      else unbindLeafFromSlot(leafId, s);
    }
  }, [leafId, visible, focused, blocks]);

  const write = useCallback(
    (data: string) => sessions.get(leafId)?.pty?.write(data),
    [leafId],
  );

  const focus = useCallback(() => focusSlot(leafId), [leafId]);

  const getBuffer = useCallback(
    (maxLines = 200): string | null => {
      const s = sessions.get(leafId);
      if (!s) return null;
      const slot = getSlotForLeaf(leafId);
      if (slot) {
        const buf = slot.term.buffer.active;
        const total = buf.length;
        const lines: string[] = [];
        const start = Math.max(0, total - maxLines);
        for (let i = start; i < total; i++) {
          lines.push(buf.getLine(i)?.translateToString(true) ?? "");
        }
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        return lines.join("\n");
      }
      if (!s.snapshot) return "";
      const plain = stripAnsi(s.snapshot);
      const lines = plain.split(/\r?\n/);
      const tail = lines.slice(-maxLines);
      while (tail.length && tail[tail.length - 1] === "") tail.pop();
      return tail.join("\n");
    },
    [leafId],
  );

  const getSelection = useCallback((): string | null => {
    const slot = getSlotForLeaf(leafId);
    const sel = slot?.term.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  const applyTheme = useCallback(() => {
    applyPoolTheme();
  }, []);

  const submitCommand = useCallback(
    (text: string) => {
      sessions
        .get(leafId)
        ?.pty?.write(`${text}\r`)
        ?.catch((e) => reportWriteFailure(leafId, e));
    },
    [leafId],
  );

  const interrupt = useCallback(() => {
    sessions
      .get(leafId)
      ?.pty?.write("\x03")
      ?.catch((e) => reportWriteFailure(leafId, e));
  }, [leafId]);

  const selectBlockAt = useCallback(
    (clientY: number) =>
      sessions.get(leafId)?.blockDecorations?.selectBlockAt(clientY),
    [leafId],
  );

  return useMemo(
    () => ({
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
      blockMode,
      submitCommand,
      interrupt,
      selectBlockAt,
    }),
    [
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
      blockMode,
      submitCommand,
      interrupt,
      selectBlockAt,
    ],
  );
}

const ANSI_RE =
  /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[78=>]|\x1bc|\x1b[NOP\]X^_]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function terminalDebugStats() {
  const liveSessions = [...sessions.entries()].map(([leafId, s]) => ({
    leafId,
    pty: !!s.pty,
    visible: s.visibleNow,
    focused: s.focusedNow,
    hasSlot: s.hasSlot,
    ringBytes: s.dormantRing.byteLength(),
    snapshotLen: s.snapshot?.length ?? 0,
    shellExited: s.shellExited,
  }));
  const ringTotal = liveSessions.reduce((n, s) => n + s.ringBytes, 0);
  const snapshotTotal = liveSessions.reduce((n, s) => n + s.snapshotLen, 0);
  const slots = poolSlotStats();
  return {
    poolSize: poolSize(),
    webglContexts: slots.filter((s) => s.webgl).length,
    idleSlots: slots.filter((s) => s.leafId === null).length,
    slots,
    sessionCount: liveSessions.length,
    sessions: liveSessions,
    ringBytesTotal: ringTotal,
    snapshotCharsTotal: snapshotTotal,
    domCanvases: document.querySelectorAll("canvas").length,
    domScreens: document.querySelectorAll(".xterm-screen").length,
    domRows: document.querySelectorAll(".xterm-rows > div").length,
    jsHeapBytes:
      (performance as unknown as { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? null,
  };
}

if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __teraxTerm?: unknown }).__teraxTerm =
    terminalDebugStats;
  (window as unknown as { __teraxPerf?: unknown }).__teraxPerf = {
    sample: perfSample,
  };
  perfStartFramePump();
}
