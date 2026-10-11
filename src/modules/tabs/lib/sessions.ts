import { LazyStore } from "@tauri-apps/plugin-store";
import {
  findLeafCwd,
  leafIds,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { getLeafSessionConfig } from "@/modules/terminal/lib/useTerminalSession";
import type { SshHost } from "@/modules/ssh/store";
import type { Tab } from "./useTabs";

/**
 * Session restore (quit → relaunch): reopens tab frames, directories and
 * connections. Running processes, scrollback and unsaved editor content do
 * NOT survive — shells respawn fresh like iTerm/VS Code. Passwords are never
 * written here (only host ids; re-resolved from the keychain at restore).
 */

export const SESSIONS_VERSION = 1;
export const MAX_SNAPSHOT_TABS = 50;

const STORE_PATH = "terax-sessions.json";
const KEY_SNAPSHOT = "snapshot";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type SnapshotLeaf = {
  /** Per-leaf cwd (pane splits can live in different dirs). */
  cwd?: string;
  /** Stable SSH host id — resolved + password-filled at restore time. */
  sshHostId?: string;
  /** Baked-in command override (e.g. ssh argv). */
  command?: string[];
};

export type SnapshotPane =
  | { kind: "leaf"; leaf: SnapshotLeaf }
  | { kind: "split"; dir: SplitDir; children: SnapshotPane[] };

export type SnapshotTab =
  | {
      kind: "terminal";
      title: string;
      customTitle?: string;
      blocks?: boolean;
      private?: boolean;
      sshHostId?: string;
      panes: SnapshotPane;
      activeLeafIndex: number;
    }
  | { kind: "editor"; path: string }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: string };

export type SessionsSnapshot = {
  version: number;
  tabs: SnapshotTab[];
  /** Position (not id — ids are fresh) of the active tab. */
  activeIndex: number;
};

/** Strip one layer of matching surrounding quotes from a directory for
 *  storage. Shell-echoed paths sometimes arrive wrapped (`'/ruta/x'`),
 *  and persisting the quotes would re-apply them on restore. Returns null
 *  for empty results. (A directory legitimately named with outer quotes is
 *  pathological; plain storage wins.) */
export function sanitizeSnapshotCwd(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (
      (first === "'" && last === "'") ||
      (first === '"' && last === '"')
    ) {
      const inner = trimmed.slice(1, -1);
      return inner ? inner : null;
    }
  }
  return trimmed ? trimmed : null;
}

/** Which SSH host (if any) a leaf restores as. A mounted local leaf in a
 *  mixed tab must NOT inherit the tab's host (it would wrongly dial SSH);
 *  only a never-mounted leaf falls back to the tab-level host. */
export function leafSshHostId(
  sessionSshHostId: string | undefined,
  hasLiveSession: boolean,
  tabSshHostId: string | undefined,
): string | undefined {
  if (sessionSshHostId) return sessionSshHostId;
  if (hasLiveSession) return undefined;
  return tabSshHostId;
}

function snapshotLeaf(
  tab: Extract<Tab, { kind: "terminal" }>,
  leafId: number,
): SnapshotLeaf {
  const cfg = getLeafSessionConfig(leafId);
  const out: SnapshotLeaf = {};
  const sshHostId = leafSshHostId(
    cfg?.sshHost?.id,
    cfg !== null,
    tab.sshHostId,
  );
  if (sshHostId) out.sshHostId = sshHostId;
  const cwd = findLeafCwd(tab.paneTree, leafId);
  const clean = cwd === undefined ? null : sanitizeSnapshotCwd(cwd);
  if (clean) out.cwd = clean;
  const command = cfg?.command ?? tab.command;
  if (command && command.length > 0) out.command = [...command];
  return out;
}

function snapshotPane(
  tab: Extract<Tab, { kind: "terminal" }>,
  node: PaneNode,
): SnapshotPane {
  if (node.kind === "leaf") {
    return { kind: "leaf", leaf: snapshotLeaf(tab, node.id) };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => snapshotPane(tab, c)),
  };
}

function snapshotTerminal(
  tab: Extract<Tab, { kind: "terminal" }>,
): SnapshotTab {
  const order = leafIds(tab.paneTree);
  return {
    kind: "terminal",
    title: tab.customTitle ?? tab.title,
    ...(tab.customTitle ? { customTitle: tab.customTitle } : {}),
    ...(tab.blocks ? { blocks: true } : {}),
    ...(tab.private ? { private: true } : {}),
    ...(tab.sshHostId ? { sshHostId: tab.sshHostId } : {}),
    panes: snapshotPane(tab, tab.paneTree),
    activeLeafIndex: Math.max(0, order.indexOf(tab.activeLeafId)),
  };
}

/** Minimal restorable shape per tab. Skipped (transient or pref-driven):
 *  preview-flag editors, ai-diff (dead approval ids), git diff/history
 *  views, and the SFTP tab (owned by its own toggle). Dirty editors keep
 *  their path only — content is whatever is on disk. */
export function serializeTabs(tabs: Tab[]): SnapshotTab[] {
  const out: SnapshotTab[] = [];
  for (const tab of tabs) {
    if (out.length >= MAX_SNAPSHOT_TABS) break;
    switch (tab.kind) {
      case "terminal":
        out.push(snapshotTerminal(tab));
        break;
      case "editor":
        if (!tab.preview) out.push({ kind: "editor", path: tab.path });
        break;
      case "preview":
        if (tab.url) out.push({ kind: "preview", url: tab.url });
        break;
      case "markdown":
        out.push({ kind: "markdown", path: tab.path });
        break;
      default:
        break;
    }
  }
  return out;
}

export type ResolvedHost = SshHost & { password?: string };

function buildPane(
  node: SnapshotPane,
  nextId: () => number,
  seeds: Array<{
    id: number;
    cwd?: string;
    command?: string[];
    sshHost?: ResolvedHost;
  }>,
  resolveHost: (sshHostId: string) => ResolvedHost | undefined,
): PaneNode {
  if (node.kind === "leaf") {
    const id = nextId();
    const sshHost = node.leaf.sshHostId
      ? resolveHost(node.leaf.sshHostId)
      : undefined;
    // Heal snapshots saved before cwd sanitizing existed.
    const leafCwd = node.leaf.cwd
      ? (sanitizeSnapshotCwd(node.leaf.cwd) ?? undefined)
      : undefined;
    seeds.push({
      id,
      cwd: leafCwd,
      command: node.leaf.command,
      sshHost,
    });
    return { kind: "leaf", id, cwd: leafCwd };
  }
  return {
    kind: "split",
    id: nextId(),
    dir: node.dir,
    children: node.children.map((c) => buildPane(c, nextId, seeds, resolveHost)),
  };
}

export type RestoredWorkspace = {
  tabs: Tab[];
  activeId: number;
  seeds: Array<{
    id: number;
    cwd?: string;
    command?: string[];
    sshHost?: ResolvedHost;
  }>;
  /** Highest id used — the tab hook must continue counting above it. */
  maxId: number;
};

function isSnapshotTab(value: unknown): value is SnapshotTab {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "terminal" || kind === "editor" || kind === "preview" || kind === "markdown"
  );
}

/** Rebuilds tab frames with fresh ids. Returns null for empty/invalid
 *  snapshots (caller falls back to a fresh window). Passwords must already
 *  be resolved — see `resolveHost`. */
export function deserializeTabs(
  snapshot: SessionsSnapshot,
  resolveHost: (sshHostId: string) => ResolvedHost | undefined,
): RestoredWorkspace | null {
  if (
    !snapshot ||
    snapshot.version !== SESSIONS_VERSION ||
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length === 0
  ) {
    return null;
  }
  let counter = 0;
  const nextId = () => ++counter;
  const tabs: Tab[] = [];
  const seeds: RestoredWorkspace["seeds"] = [];

  for (const raw of snapshot.tabs) {
    if (!isSnapshotTab(raw)) continue;
    switch (raw.kind) {
      case "terminal": {
        if (!raw.panes) break;
        const paneTree = buildPane(raw.panes, nextId, seeds, resolveHost);
        const order = leafIds(paneTree);
        if (order.length === 0) break;
        const tabId = nextId();
        const at = Math.min(raw.activeLeafIndex ?? 0, order.length - 1);
        const activeLeafId = order[at] ?? order[0] ?? 0;
        const host = raw.sshHostId ? resolveHost(raw.sshHostId) : undefined;
        tabs.push({
          id: tabId,
          kind: "terminal",
          title: raw.title || "Terminal",
          paneTree,
          activeLeafId,
          ...(raw.blocks ? { blocks: true as const } : {}),
          ...(raw.private ? { private: true as const } : {}),
          ...(raw.customTitle ? { customTitle: raw.customTitle } : {}),
          ...(raw.sshHostId ? { sshHostId: raw.sshHostId } : {}),
          ...(host ? { sshHost: host } : {}),
        });
        break;
      }
      case "editor": {
        if (!raw.path) break;
        const id = nextId();
        const base = raw.path.split(/[\\/]/).filter(Boolean).pop() ?? raw.path;
        tabs.push({
          id,
          kind: "editor",
          title: base,
          path: raw.path,
          dirty: false,
          preview: false,
        });
        break;
      }
      case "preview": {
        if (!raw.url) break;
        const id = nextId();
        let title = raw.url;
        try {
          title = new URL(raw.url).host || raw.url;
        } catch {
          /* keep raw url */
        }
        tabs.push({ id, kind: "preview", title, url: raw.url });
        break;
      }
      case "markdown": {
        if (!raw.path) break;
        const id = nextId();
        const base = raw.path.split(/[\\/]/).filter(Boolean).pop() ?? raw.path;
        tabs.push({ id, kind: "markdown", title: base, path: raw.path });
        break;
      }
    }
  }

  const first = tabs[0];
  if (!first) return null;
  const activeId =
    tabs[Math.min(snapshot.activeIndex ?? 0, tabs.length - 1)]?.id ??
    first.id;
  return { tabs, activeId, seeds, maxId: counter };
}

/** Every SSH host id referenced by a snapshot (tab-level and per-leaf),
 *  so passwords can be resolved up-front in one pass. */
export function collectSshHostIds(tabs: SnapshotTab[]): string[] {
  const ids = new Set<string>();
  const walk = (node: SnapshotPane) => {
    if (node.kind === "leaf") {
      if (node.leaf.sshHostId) ids.add(node.leaf.sshHostId);
      return;
    }
    node.children.forEach(walk);
  };
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    if (tab.sshHostId) ids.add(tab.sshHostId);
    walk(tab.panes);
  }
  return [...ids];
}

/** Highest id in use (tabs + every pane node) — restore must count above it. */
export function maxUsedId(tabs: Tab[]): number {
  let max = 0;
  const scan = (node: PaneNode) => {
    if (node.id > max) max = node.id;
    if (node.kind === "split") node.children.forEach(scan);
  };
  for (const tab of tabs) {
    if (tab.id > max) max = tab.id;
    if (tab.kind === "terminal") scan(tab.paneTree);
  }
  return max;
}

export async function loadSessionsSnapshot(): Promise<SessionsSnapshot | null> {
  try {
    const snap = await store.get<SessionsSnapshot>(KEY_SNAPSHOT);
    if (
      !snap ||
      snap.version !== SESSIONS_VERSION ||
      !Array.isArray(snap.tabs)
    ) {
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export async function saveSessionsSnapshot(
  snap: SessionsSnapshot,
): Promise<void> {
  await store.set(KEY_SNAPSHOT, snap);
  await store.save();
}
