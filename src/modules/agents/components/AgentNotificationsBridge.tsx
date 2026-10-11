import type { Tab } from "@/modules/tabs";
import {
  getCwdForLeaf,
  getLeafSessionConfig,
  hasLeaf,
  leafIdForPty,
  leafIds,
  ptyIdForLeaf,
} from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef } from "react";
import {
  OpencodeTailBuffer,
  ensureLocalPlugin,
  installRemotePlugin,
  remotePluginCurrent,
  startRemoteTail,
  stopRemoteTail,
  type TailChunk,
} from "../lib/opencodeNotify";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import { collectSshLeaves, type SshLeafReaders } from "../lib/sshLeaves";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
};

// ─── OSC-based signals (local PTY via AgentDetector in Rust) ─────────────────

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title };
    }
  }
  return null;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  ctx: Ctx,
  context?: string,
): void {
  const info = tabInfo(ctx.tabs, session.leafId);
  const heading =
    kind === "attention"
      ? `${session.agent} needs your input`
      : `${session.agent} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: context ?? info?.title,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    allowToast: kind === "attention",
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      return;
    }
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited":
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
  }
}

// ─── Transcript-based signals (local, passive, no hooks needed) ──────────────

type TranscriptPayload = { kind: "attention" | "finished"; projectDir: string; context?: string };

// Decode the directory name Claude Code uses in ~/.claude/projects/.
// Claude Code encodes absolute paths by stripping the leading / and replacing
// remaining / with -.  e.g. /Users/foo/bar -> Users-foo-bar
function decodeProjectDir(encoded: string): string {
  if (!encoded || encoded === ".") return "";
  return `/${encoded.split("-").filter(Boolean).join("/")}`;
}

function findLeafForPath(
  tabs: Tab[],
  decodedPath: string,
): { leafId: number; tabId: number; title: string } | null {
  if (!decodedPath) return null;
  for (const t of tabs) {
    if (t.kind !== "terminal") continue;
    for (const lId of leafIds(t.paneTree)) {
      const cwd = getCwdForLeaf(lId);
      if (!cwd) continue;
      if (
        decodedPath === cwd ||
        decodedPath.startsWith(cwd) ||
        cwd.startsWith(decodedPath)
      ) {
        return { leafId: lId, tabId: t.id, title: t.title };
      }
    }
  }
  return null;
}

function handleTranscriptEvent(payload: TranscriptPayload, ctx: Ctx): void {
  const decoded = decodeProjectDir(payload.projectDir);
  const match = findLeafForPath(ctx.tabs, decoded);
  const store = useAgentStore.getState();

  if (match) {
    const existing = store.sessions[match.leafId];
    if (payload.kind === "attention") {
      if (!existing) store.start(match.leafId, match.tabId, "claude");
      store.setStatus(match.leafId, "waiting");
      const session = store.sessions[match.leafId];
      if (session) route(session, "attention", ctx, payload.context);
    } else {
      if (existing) {
        store.setStatus(match.leafId, "waiting");
        route(existing, "finished", ctx, payload.context);
        maybeTriggerManagedReview(match.leafId);
      } else {
        // Claude Code finished but no active OSC session — still show notification.
        routeAgentNotification({
          source: "terminal",
          agent: "claude",
          kind: "finished",
          title: "claude finished",
          body: payload.context ?? match.title,
          focused: ctx.focused,
          visible: ctx.activeId === match.tabId,
          allowToast: false,
          tabId: match.tabId,
          leafId: match.leafId,
          onActivate: () => ctx.onActivate(match.tabId, match.leafId),
        });
      }
    }
  } else {
    // Could not map to a specific session — show generic notification.
    routeAgentNotification({
      source: "terminal",
      agent: "claude",
      kind: payload.kind === "attention" ? "attention" : "finished",
      title:
        payload.kind === "attention"
          ? "claude needs your input"
          : "claude finished",
      body: payload.context,
      focused: ctx.focused,
      visible: false,
      allowToast: payload.kind === "attention",
      onActivate: () => {},
    });
  }
}

// ─── SSH text-based tracking (Rust, over the coalesced stream) ───────────────

type SshAgentStatePayload = {
  sshId: number;
  state: string;
  previousState: string;
  context?: string | null;
};

/** Map an SSH session id to its leaf, preferring the active tab — the Rust
 *  tracker reports per session, and sessions are 1:1 with leaves. */
function findLeafForSsh(
  tabs: Tab[],
  activeId: number,
  sshId: number,
): { leafId: number; tabId: number } | null {
  let fallback: { leafId: number; tabId: number } | null = null;
  for (const t of tabs) {
    if (t.kind !== "terminal") continue;
    for (const lId of leafIds(t.paneTree)) {
      if (ptyIdForLeaf(lId) !== sshId) continue;
      if (t.id === activeId) return { leafId: lId, tabId: t.id };
      if (!fallback) fallback = { leafId: lId, tabId: t.id };
    }
  }
  return fallback;
}

const liveSshReaders: SshLeafReaders = {
  hasSshSession: (leafId) =>
    getLeafSessionConfig(leafId)?.sshHost !== undefined,
};

function sshLeafIds(tabs: Tab[]): { leafId: number; tabId: number }[] {
  return collectSshLeaves(tabs, liveSshReaders);
}

function handleSshStateChange(
  leafId: number,
  tabId: number,
  newState: string,
  prevState: string,
  ctx: Ctx,
  context?: string,
): void {
  const store = useAgentStore.getState();

  if (newState === "active" && prevState === "idle") {
    store.start(leafId, tabId, "claude");
    return;
  }
  if (newState === "permission-wait") {
    if (!store.sessions[leafId]) store.start(leafId, tabId, "claude");
    store.setStatus(leafId, "waiting");
    const session = store.sessions[leafId];
    if (session) route(session, "attention", ctx, context);
    return;
  }
  if (newState === "active" && prevState === "permission-wait") {
    store.setStatus(leafId, "working");
    return;
  }
  if (newState === "idle") {
    const session = store.sessions[leafId];
    if (session) {
      route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      store.finish(leafId);
    }
    return;
  }
}

// ─── OpenCode plugin signals (local watcher + remote tail) ────────────────

function opencodeEnabled(): boolean {
  return usePreferencesStore.getState().opencodeNotifications;
}

type OpencodePayload = {
  kind: "finished" | "attention" | "error";
  sessionId?: string | null;
  directory?: string | null;
  project?: string | null;
  detail?: string | null;
  origin: "local" | "ssh";
};

function findLeafForOpencode(
  tabs: Tab[],
  activeId: number,
  sig: OpencodePayload & { sshId?: number | null },
): { leafId: number; tabId: number; title: string } | null {
  if (sig.sshId != null) {
    // Remote: the plugin only knows cwd, not Terax leaves. Prefer a leaf of
    // the same SSH session in the active tab, else the first one there.
    const cands: { leafId: number; tabId: number; title: string }[] = [];
    for (const t of tabs) {
      if (t.kind !== "terminal") continue;
      for (const lId of leafIds(t.paneTree)) {
        if (ptyIdForLeaf(lId) === sig.sshId) {
          cands.push({ leafId: lId, tabId: t.id, title: t.title });
        }
      }
    }
    if (cands.length === 0) return null;
    return cands.find((c) => c.tabId === activeId) ?? cands[0];
  }
  if (sig.directory) return findLeafForPath(tabs, sig.directory);
  return null;
}

function handleOpencodeSignal(
  sig: OpencodePayload & { sshId?: number | null },
  ctx: Ctx,
): void {
  if (!usePreferencesStore.getState().opencodeNotifications) return;
  const store = useAgentStore.getState();
  const match = findLeafForOpencode(ctx.tabs, ctx.activeId, sig);
  const kind = sig.kind === "finished" ? "finished" : "attention";
  const title =
    sig.kind === "finished"
      ? "opencode finished"
      : sig.kind === "error"
        ? "opencode error"
        : "opencode needs your input";
  const body = sig.detail ?? match?.title ?? sig.project ?? undefined;

  if (match) {
    if (!store.sessions[match.leafId]) {
      store.start(match.leafId, match.tabId, "opencode");
    }
    store.setStatus(match.leafId, "waiting");
    routeAgentNotification({
      source: "terminal",
      agent: "opencode",
      kind,
      title,
      body,
      focused: ctx.focused,
      visible: ctx.activeId === match.tabId,
      allowToast: kind === "attention",
      tabId: match.tabId,
      leafId: match.leafId,
      onActivate: () => ctx.onActivate(match.tabId, match.leafId),
    });
    if (kind === "finished") maybeTriggerManagedReview(match.leafId);
  } else {
    // Could not map to a pane — generic notification without a target.
    routeAgentNotification({
      source: "terminal",
      agent: "opencode",
      kind,
      title,
      body,
      focused: ctx.focused,
      visible: false,
      allowToast: kind === "attention",
      onActivate: () => {},
    });
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
}: {
  tabs: Tab[];
  activeId: number;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ tabs, activeId, focused, onActivate });
  ctxRef.current = { tabs, activeId, focused, onActivate };

  // OSC-based signals from local PTY AgentDetector.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("terax:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Transcript-based signals from the Rust watcher (passive, no hooks needed).
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<TranscriptPayload>("terax:claude-transcript", (e) =>
      handleTranscriptEvent(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // OpenCode plugin signals: local watcher file + remote tails.
  const tailBufferRef = useRef(new OpencodeTailBuffer());
  const remoteTailsRef = useRef(new Map<number, number>());

  useEffect(() => {
    // Idempotent: installs/refreshes the local plugin when enabled.
    if (opencodeEnabled()) void ensureLocalPlugin();
    let alive = true;
    const unlistens: Array<() => void> = [];
    listen<OpencodePayload>("terax:opencode-signal", (e) =>
      handleOpencodeSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlistens.push(u);
        else u();
      })
      .catch(() => {});
    listen<TailChunk>("terax:opencode-tail", (e) => {
      const sigs = tailBufferRef.current.push(e.payload.sshId, e.payload.chunk);
      for (const s of sigs) handleOpencodeSignal(s, ctxRef.current);
    })
      .then((u) => {
        if (alive) unlistens.push(u);
        else u();
      })
      .catch(() => {});
    listen<{ tailId: number; sshId: number }>(
      "terax:opencode-tail-closed",
      (e) => {
        tailBufferRef.current.clear(e.payload.sshId);
        remoteTailsRef.current.delete(e.payload.sshId);
      },
    )
      .then((u) => {
        if (alive) unlistens.push(u);
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      for (const u of unlistens) u();
    };
  }, []);

  // SSH text-based tracking -- one PtyClaudeTracker per SSH leaf.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Stable key that changes only when the SSH leaf set changes (avoids
  // biome's conflicting exhaustive-deps / extra-deps warnings on a derived
  // expression used directly in the dep array).
  const sshLeafKey = useMemo(
    () => sshLeafIds(tabs).map((x) => x.leafId).join(","),
    [tabs],
  );

  // OpenCode remote setup: ensure the notifier plugin on each SSH host and
  // stream its events file. Idempotent and version-checked; one tail per
  // SSH session. A periodic rescan (plus SSH-activity nudges) heals three
  // races the leaf-set key cannot see: setup attempted before the session
  // connected, tails closed by a transport drop, and failures worth
  // retrying after a cooldown instead of spamming ssh_exec.
  const remoteSetupRef = useRef(new Set<number>());
  const setupFailedRef = useRef(new Map<number, number>());
  const SETUP_RESCAN_MS = 20_000;
  const SETUP_FAIL_COOLDOWN_MS = 5 * 60_000;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sshLeafKey is the intentional trigger
  useEffect(() => {
    let alive = true;

    const stopStaleTails = (live: Set<number>) => {
      for (const [sshId, tailId] of remoteTailsRef.current) {
        if (!live.has(sshId)) {
          remoteTailsRef.current.delete(sshId);
          tailBufferRef.current.clear(sshId);
          void stopRemoteTail(tailId);
        }
      }
    };

    const scan = () => {
      if (!alive) return;
      if (!opencodeEnabled()) {
        stopStaleTails(new Set());
        return;
      }
      const live = new Set<number>();
      for (const { leafId } of sshLeafIds(tabsRef.current)) {
        const sshId = ptyIdForLeaf(leafId);
        if (sshId !== null) live.add(sshId);
      }
      stopStaleTails(live);
      for (const sshId of setupFailedRef.current.keys()) {
        if (!live.has(sshId)) setupFailedRef.current.delete(sshId);
      }
      for (const sshId of live) {
        if (remoteTailsRef.current.has(sshId)) continue;
        if (remoteSetupRef.current.has(sshId)) continue;
        const failedAt = setupFailedRef.current.get(sshId) ?? 0;
        if (Date.now() - failedAt < SETUP_FAIL_COOLDOWN_MS) continue;
        remoteSetupRef.current.add(sshId);
        void (async () => {
          try {
            const current = await remotePluginCurrent(sshId);
            if (!current) {
              const ok = await installRemotePlugin(sshId);
              if (!ok) {
                setupFailedRef.current.set(sshId, Date.now());
                return;
              }
            }
            const tailId = await startRemoteTail(sshId);
            if (tailId === null) {
              setupFailedRef.current.set(sshId, Date.now());
              return;
            }
            if (!alive) {
              // Torn down mid-setup: don't leak the tail.
              void stopRemoteTail(tailId);
              return;
            }
            remoteTailsRef.current.set(sshId, tailId);
            setupFailedRef.current.delete(sshId);
          } finally {
            remoteSetupRef.current.delete(sshId);
          }
        })();
      }
    };

    scan();
    const timer = setInterval(scan, SETUP_RESCAN_MS);
    // Nudge the scan when SSH sessions connect or traffic flows: a setup
    // attempted before connect left nothing behind to retry on.
    const onActivity = () => scan();
    window.addEventListener("terax:ssh-activity", onActivity);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("terax:ssh-activity", onActivity);
      // A4: stop only tails whose session is actually gone — the old code
      // passed an empty set and restarted EVERY tail (2 ssh_exec per host)
      // on any SSH tab open/close. In-flight setups are NOT cleared: they
      // self-guard via `alive` (stopping a tail opened mid-teardown) and
      // delete their own entry in `finally`, so clearing here could only
      // spawn duplicates for the same sshId.
      const live = new Set<number>();
      for (const { leafId } of sshLeafIds(tabsRef.current)) {
        const sshId = ptyIdForLeaf(leafId);
        if (sshId !== null) live.add(sshId);
      }
      stopStaleTails(live);
    };
  }, [sshLeafKey]);

  // SSH agent states arrive as transition events from the Rust tracker
  // (zero per-chunk JS work — the old PtyClaudeTracker is gone). Routing
  // reuses handleSshStateChange unchanged.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<SshAgentStatePayload>("terax:ssh-agent-state", (e) => {
      const ctx = ctxRef.current;
      const match = findLeafForSsh(ctx.tabs, ctx.activeId, e.payload.sshId);
      if (!match) return;
      handleSshStateChange(
        match.leafId,
        match.tabId,
        e.payload.state,
        e.payload.previousState,
        ctx,
        e.payload.context ?? undefined,
      );
    })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return null;
}
