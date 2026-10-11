import type { UIMessage } from "@ai-sdk/react";
import { LazyStore } from "@tauri-apps/plugin-store";

export type SessionScopeType = "terminal" | "workspace";

export type SessionScope = {
  type: SessionScopeType;
  targetId: string;
};

export type SessionMeta = {
  id: string;
  title: string;
  scope?: SessionScope;
  createdAt: number;
  updatedAt: number;
};

const STORE_PATH = "terax-ai-sessions.json";
const KEY_SESSIONS = "sessions";
const KEY_ACTIVE = "activeId";
const KEY_ACTIVE_BY_SCOPE = "activeByScope";
const messagesKey = (id: string) => `messages:${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedSessions = {
  sessions: SessionMeta[];
  activeId: string | null;
  activeByScope: Record<string, string>;
};

export function scopeKey(scope: SessionScope): string {
  return `${scope.type}:${scope.targetId}`;
}

export function sameScope(a: SessionScope | undefined, b: SessionScope): boolean {
  return !!a && a.type === b.type && a.targetId === b.targetId;
}

export function sessionMatchesScope(
  session: SessionMeta,
  scope: SessionScope,
): boolean {
  return sameScope(session.scope, scope);
}

export function findActiveForScope(
  sessions: SessionMeta[],
  activeByScope: Record<string, string>,
  scope: SessionScope,
): string | null {
  const id = activeByScope[scopeKey(scope)];
  if (!id) return null;
  const session = sessions.find((s) => s.id === id);
  return session && sessionMatchesScope(session, scope) ? id : null;
}

export function pruneActiveByScope(
  activeByScope: Record<string, string>,
  sessions: SessionMeta[],
): Record<string, string> {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const next: Record<string, string> = {};
  for (const [key, id] of Object.entries(activeByScope)) {
    const session = byId.get(id);
    if (!session?.scope) continue;
    if (scopeKey(session.scope) !== key) continue;
    next[key] = id;
  }
  return next;
}

/** Split a terminal scope targetId (`leafId` or `leafId:ssh:hostId`)
 *  into its stable connection part. Null for non-terminal scopes. */
export function parseTerminalScope(targetId: string): {
  leafId: number;
  sshHostId: string | null;
} | null {
  const m = /^(\d+)(?::ssh:(.+))?$/.exec(targetId);
  if (!m) return null;
  return { leafId: Number(m[1]), sshHostId: m[2] ?? null };
}

/** Most recently active session on the same SSH connection (same host),
 *  if any. Used when a host is reopened with fresh leaf ids: the old
 *  scope key died with the closed tab, but the conversation belongs to
 *  the connection and is adopted instead of abandoned. Local scopes
 *  deliberately have no fallback — a bare leafId carries no stable
 *  identity, and attaching another directory's chat would be worse than
 *  starting blank. */
export function findRecentSessionForConnection(
  sessions: SessionMeta[],
  scope: SessionScope,
): SessionMeta | null {
  if (scope.type !== "terminal") return null;
  const parsed = parseTerminalScope(scope.targetId);
  if (!parsed?.sshHostId) return null;
  const suffix = `:ssh:${parsed.sshHostId}`;
  let best: SessionMeta | null = null;
  for (const s of sessions) {
    if (s.scope?.type !== "terminal") continue;
    if (!s.scope.targetId.endsWith(suffix)) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

/** Drop scope mappings whose leaf/tab no longer exists (closed tabs and
 *  panes). Dead keys otherwise pin orphan sessions as "claimed" forever,
 *  blocking connection adoption, and grow the map without bound. */
export function pruneScopesToLiveKeys(
  activeByScope: Record<string, string>,
  liveLeaves: Set<number>,
  liveTabs: Set<number>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, id] of Object.entries(activeByScope)) {
    const [type, target] = key.split(":", 2);
    if (type === "terminal") {
      const parsed = target ? parseTerminalScope(target) : null;
      if (!parsed || !liveLeaves.has(parsed.leafId)) continue;
    } else if (type === "workspace") {
      const tabId = Number(target);
      if (!Number.isFinite(tabId) || !liveTabs.has(tabId)) continue;
    } else {
      continue;
    }
    next[key] = id;
  }
  return next;
}

export async function loadAll(): Promise<LoadedSessions> {
  const entries = await store.entries();
  let sessions: SessionMeta[] | undefined;
  let activeId: string | null | undefined;
  let activeByScope: Record<string, string> | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_SESSIONS) sessions = v as SessionMeta[];
    else if (k === KEY_ACTIVE) activeId = v as string | null;
    else if (k === KEY_ACTIVE_BY_SCOPE) activeByScope = v as Record<string, string>;
  }
  return {
    sessions: sessions ?? [],
    activeId: activeId ?? null,
    activeByScope: activeByScope ?? {},
  };
}

export async function loadMessages(id: string): Promise<UIMessage[] | null> {
  return (await store.get<UIMessage[]>(messagesKey(id))) ?? null;
}

export async function saveSessionsList(sessions: SessionMeta[]): Promise<void> {
  await store.set(KEY_SESSIONS, sessions);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveActiveByScope(map: Record<string, string>): Promise<void> {
  await store.set(KEY_ACTIVE_BY_SCOPE, map);
}

export async function saveMessages(
  id: string,
  messages: UIMessage[],
): Promise<void> {
  await store.set(messagesKey(id), messages);
}

export async function deleteSessionData(id: string): Promise<void> {
  await store.delete(messagesKey(id));
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "text") continue;
      const text = (p as { text: string }).text
        .replace(/<terminal-context[\s\S]*?<\/terminal-context>\s*/g, "")
        .replace(/<selection[\s\S]*?<\/selection>\s*/g, "")
        .replace(/<file[\s\S]*?<\/file>\s*/g, "")
        .trim();
      if (!text) continue;
      const first = text.split("\n")[0].trim();
      return first.length > 40 ? `${first.slice(0, 40)}…` : first;
    }
  }
  return "New chat";
}
