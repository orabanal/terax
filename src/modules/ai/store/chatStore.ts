import type { Chat, UIMessage } from "@ai-sdk/react";
import { create } from "zustand";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModel,
  isCompatModelId,
  providerNeedsKey,
  type ModelId,
  type ProviderId,
} from "../config";
import { useTodosStore } from "./todoStore";
import type { AgentUsage } from "../lib/agent";
import { EMPTY_PROVIDER_KEYS, type ProviderKeys, type CustomEndpointKeys } from "../lib/keyring";
import {
  deleteSessionData,
  deriveTitle,
  findActiveForScope,
  loadAll,
  loadMessages,
  newSessionId,
  pruneActiveByScope,
  saveActiveByScope,
  saveActiveId,
  saveMessages,
  saveSessionsList,
  scopeKey,
  sessionMatchesScope,
  type SessionMeta,
  type SessionScope,
} from "../lib/sessions";
import { pushRecentModel } from "../lib/modelPrefs";
import type { PermissionMode } from "../tools/context";

export type { PermissionMode };

export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high";

export type Live = {
  getCwd: () => string | null;
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  injectIntoActivePty: (text: string) => boolean;
  /** Scope-aware: read from a specific terminal leaf instead of the active tab. */
  getCwdForLeaf: (leafId: number) => string | null;
  /** Scope-aware: read terminal buffer from a specific leaf. */
  getTerminalContextForLeaf: (leafId: number) => string | null;
  /** Scope-aware: check if a specific terminal leaf is private. */
  isTerminalPrivateForLeaf: (leafId: number) => boolean;
  /** Scope-aware: write to a specific terminal leaf. */
  injectIntoPtyForLeaf: (leafId: number, text: string) => boolean;
  /** Scope-aware: check if a specific terminal leaf is an SSH session. */
  isTerminalSshForLeaf: (leafId: number) => boolean;
  /** Get the PTY/SSH session id for a specific terminal leaf. */
  getSshSessionIdForLeaf: (leafId: number) => number | null;
  getWorkspaceRoot: () => string | null;
  getActiveFile: () => string | null;
  openPreview: (url: string) => boolean;
  spawnManagedAgent: (
    prompt: string,
    sessionId: string,
  ) => { tabId: number; leafId: number } | null;
  readLeafBuffer: (leafId: number) => string | null;
};

export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "awaiting-approval"
  | "error";

export type AgentMeta = {
  status: AgentRunStatus;
  step: string | null;
  approvalsPending: number;
  error: string | null;
  tokens: AgentUsage;
  lastInputTokens: number;
  lastCachedTokens: number;
  hitStepCap: boolean;
  compactionNotice: { droppedCount: number; at: number } | null;
};

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

const IDLE_META: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: ZERO_USAGE,
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
};

export type MiniState = {
  open: boolean;
};

export type PendingSelection = {
  id: string;
  text: string;
  source: "terminal" | "editor";
};

export type ApprovalResponder = (approved: boolean) => void;

type StoreState = {
  live: Live;
  setLive: (live: Live) => void;

  approvalResponders: Record<string, ApprovalResponder>;
  setApprovalResponder: (
    approvalId: string,
    fn: ApprovalResponder | null,
  ) => void;
  respondToApproval: (approvalId: string, approved: boolean) => void;

  apiKeys: ProviderKeys;
  setApiKeys: (keys: ProviderKeys) => void;
  setApiKey: (provider: ProviderId, key: string | null) => void;

  customEndpointKeys: CustomEndpointKeys;
  setCustomEndpointKeys: (keys: CustomEndpointKeys) => void;

  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  selectedModelByScope: Record<string, string>;
  getSelectedModelForScope: (scopeKey: string) => string;
  setSelectedModelForScope: (scopeKey: string, id: string) => void;

  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  permissionModeByScope: Record<string, PermissionMode>;
  getPermissionModeForScope: (scopeKey: string) => PermissionMode;
  setPermissionModeForScope: (scopeKey: string, mode: PermissionMode) => void;

  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  reasoningEffortByScope: Record<string, ReasoningEffort>;
  getReasoningEffortForScope: (scopeKey: string) => ReasoningEffort;
  setReasoningEffortForScope: (scopeKey: string, effort: ReasoningEffort) => void;

  commandBlocklist: string[];
  setCommandBlocklist: (patterns: string[]) => void;

  mini: MiniState;
  openMini: () => void;
  closeMini: () => void;
  toggleMini: () => void;

  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  focusSignal: number;
  pendingPrefill: string | null;
  focusInput: (prefill?: string | null) => void;
  consumePrefill: () => string | null;

  pendingSelections: PendingSelection[];
  attachSelection: (text: string, source: "terminal" | "editor") => void;
  consumeSelections: () => PendingSelection[];

  agentMeta: AgentMeta;
  agentMetaBySession: Record<string, AgentMeta>;
  getAgentMetaForSession: (sessionId: string) => AgentMeta;
  patchAgentMeta: (patch: Partial<AgentMeta>) => void;
  patchAgentMetaForSession: (
    sessionId: string,
    patch: Partial<AgentMeta>,
  ) => void;
  resetAgentMeta: () => void;
  resetAgentMetaForSession: (sessionId: string) => void;

  // Sessions
  sessionsHydrated: boolean;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  activeByScope: Record<string, string>;
  hydrateSessions: () => Promise<void>;
  newSession: (scope?: SessionScope) => string;
  switchSession: (id: string) => void;
  ensureSessionForScope: (scope: SessionScope) => string;
  switchSessionForScope: (scope: SessionScope, id: string) => void;
  getActiveSessionForScope: (scope: SessionScope) => string | null;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Persist messages of a session and bump its updatedAt + auto-title. */
  persistMessages: (id: string, messages: UIMessage[]) => void;
};

const NOOP_LIVE: Live = {
  getCwd: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  getCwdForLeaf: () => null,
  getTerminalContextForLeaf: () => null,
  isTerminalPrivateForLeaf: () => false,
  injectIntoPtyForLeaf: () => false,
  isTerminalSshForLeaf: () => false,
  getSshSessionIdForLeaf: () => null,
  getWorkspaceRoot: () => null,
  getActiveFile: () => null,
  openPreview: () => false,
  spawnManagedAgent: () => null,
  readLeafBuffer: () => null,
};

const CHATS_LRU_CAP = 8;
export const chats = new Map<string, Chat<UIMessage>>();

export function touchChat(id: string, c: Chat<UIMessage>) {
  if (chats.has(id)) chats.delete(id);
  chats.set(id, c);

  const state = useChatStore.getState();
  const protectedIds = new Set(Object.values(state.activeByScope));
  if (state.activeSessionId) protectedIds.add(state.activeSessionId);

  let attempts = chats.size;
  while (chats.size > CHATS_LRU_CAP && attempts > 0) {
    attempts -= 1;
    const oldest = chats.keys().next().value;
    if (!oldest || oldest === id) break;
    if (protectedIds.has(oldest)) {
      const protectedChat = chats.get(oldest);
      if (!protectedChat) break;
      chats.delete(oldest);
      chats.set(oldest, protectedChat);
      continue;
    }
    flushPersistEntry(oldest);
    void chats.get(oldest)?.stop();
    chats.delete(oldest);
  }
}
// Initial messages for a session, populated at hydration time and consumed
// when the matching Chat is constructed.
export const seedMessages = new Map<string, UIMessage[]>();

// Trailing debounce for per-token message persistence. Streaming fires
// `persistMessages` on every token; without this we'd JSON-serialize the
// full message array and round-trip to the store plugin per token, which
// stalls the UI. Flush on idle (status transition) via `flushPersist`.
const PERSIST_DEBOUNCE_MS = 300;
const pendingPersist = new Map<
  string,
  { latest: UIMessage[]; timer: ReturnType<typeof setTimeout> }
>();

function flushPersistEntry(id: string) {
  const entry = pendingPersist.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingPersist.delete(id);
  void saveMessages(id, entry.latest);
}

export function flushPersist(id?: string): void {
  if (id) {
    flushPersistEntry(id);
    return;
  }
  for (const key of Array.from(pendingPersist.keys())) flushPersistEntry(key);
}

export const useChatStore = create<StoreState>((set, get) => ({
  live: NOOP_LIVE,
  setLive: (live) => set({ live }),

  approvalResponders: {},
  setApprovalResponder: (approvalId, fn) =>
    set((s) => {
      const next = { ...s.approvalResponders };
      if (fn) next[approvalId] = fn;
      else delete next[approvalId];
      return { approvalResponders: next };
    }),
  respondToApproval: (approvalId, approved) => {
    const fn = get().approvalResponders[approvalId];
    if (!fn) return;
    set((s) => {
      const next = { ...s.approvalResponders };
      delete next[approvalId];
      return { approvalResponders: next };
    });
    fn(approved);
  },

  apiKeys: { ...EMPTY_PROVIDER_KEYS },
  setApiKeys: (keys) => set({ apiKeys: keys }),
  setApiKey: (provider, key) => {
    set({ apiKeys: { ...get().apiKeys, [provider]: key } });
  },

  customEndpointKeys: {},
  setCustomEndpointKeys: (keys) => set({ customEndpointKeys: keys }),

  selectedModelId: DEFAULT_MODEL_ID,
  setSelectedModelId: (id) => {
    set({ selectedModelId: id });
    void pushRecentModel(id);
  },
  selectedModelByScope: {},
  getSelectedModelForScope: (key) =>
    get().selectedModelByScope[key] ?? get().selectedModelId,
  setSelectedModelForScope: (key, id) => {
    set((s) => ({ selectedModelByScope: { ...s.selectedModelByScope, [key]: id } }));
    void pushRecentModel(id);
  },

  permissionMode: "confirm",
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  permissionModeByScope: {},
  getPermissionModeForScope: (key) =>
    get().permissionModeByScope[key] ?? get().permissionMode,
  setPermissionModeForScope: (key, mode) =>
    set((s) => ({ permissionModeByScope: { ...s.permissionModeByScope, [key]: mode } })),

  reasoningEffort: "auto",
  setReasoningEffort: (effort) => set({ reasoningEffort: effort }),
  reasoningEffortByScope: {},
  getReasoningEffortForScope: (key) =>
    get().reasoningEffortByScope[key] ?? get().reasoningEffort,
  setReasoningEffortForScope: (key, effort) =>
    set((s) => ({ reasoningEffortByScope: { ...s.reasoningEffortByScope, [key]: effort } })),

  commandBlocklist: [],
  setCommandBlocklist: (patterns) => set({ commandBlocklist: patterns }),

  mini: { open: false },
  openMini: () => set({ mini: { open: true } }),
  closeMini: () => set({ mini: { open: false } }),
  toggleMini: () => set((s) => ({ mini: { open: !s.mini.open } })),

  panelOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  focusSignal: 0,
  pendingPrefill: null,
  focusInput: (prefill = null) =>
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingPrefill: prefill ?? null,
    })),
  consumePrefill: () => {
    const v = get().pendingPrefill;
    if (v != null) set({ pendingPrefill: null });
    return v;
  },

  pendingSelections: [],
  attachSelection: (text, source) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingSelections: [...s.pendingSelections, { id, text: trimmed, source }],
    }));
  },
  consumeSelections: () => {
    const v = get().pendingSelections;
    if (v.length > 0) set({ pendingSelections: [] });
    return v;
  },

  agentMeta: IDLE_META,
  agentMetaBySession: {},
  getAgentMetaForSession: (sessionId) =>
    get().agentMetaBySession[sessionId] ?? IDLE_META,
  patchAgentMeta: (patch) =>
    set((s) => ({ agentMeta: { ...s.agentMeta, ...patch } })),
  patchAgentMetaForSession: (sessionId, patch) =>
    set((s) => {
      const nextMeta = {
        ...(s.agentMetaBySession[sessionId] ?? IDLE_META),
        ...patch,
      };
      return {
        agentMetaBySession: {
          ...s.agentMetaBySession,
          [sessionId]: nextMeta,
        },
        ...(s.activeSessionId === sessionId ? { agentMeta: nextMeta } : {}),
      };
    }),
  resetAgentMeta: () => set({ agentMeta: IDLE_META }),
  resetAgentMetaForSession: (sessionId) =>
    set((s) => ({
      agentMetaBySession: { ...s.agentMetaBySession, [sessionId]: IDLE_META },
      ...(s.activeSessionId === sessionId ? { agentMeta: IDLE_META } : {}),
    })),

  sessionsHydrated: false,
  sessions: [],
  activeSessionId: null,
  activeByScope: {},

  hydrateSessions: async () => {
    if (get().sessionsHydrated) return;
    const { sessions, activeId, activeByScope } = await loadAll();
    const validActiveId = sessions.some((s) => s.id === activeId)
      ? activeId
      : null;
    const scopedActive = pruneActiveByScope(activeByScope, sessions);
    const preloadIds = Array.from(
      new Set([
        ...Object.values(scopedActive),
        ...(validActiveId ? [validActiveId] : []),
      ]),
    );
    await Promise.all(
      preloadIds.map(async (id) => {
        if (chats.has(id) || seedMessages.has(id)) return;
        const messages = await loadMessages(id);
        if (messages && messages.length > 0) seedMessages.set(id, messages);
      }),
    );

    set({
      sessions,
      activeSessionId: validActiveId,
      activeByScope: scopedActive,
      sessionsHydrated: true,
    });
    if (validActiveId !== activeId) void saveActiveId(validActiveId);
    if (JSON.stringify(scopedActive) !== JSON.stringify(activeByScope)) {
      void saveActiveByScope(scopedActive);
    }
  },

  newSession: (scope?: SessionScope) => {
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      scope,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [meta, ...get().sessions];
    const scopeUpdate: Record<string, string> = { ...get().activeByScope };
    if (scope) {
      scopeUpdate[scopeKey(scope)] = id;
      void saveActiveByScope(scopeUpdate);
    }
    set({
      sessions: next,
      activeSessionId: id,
      activeByScope: scopeUpdate,
      agentMeta: IDLE_META,
      agentMetaBySession: { ...get().agentMetaBySession, [id]: IDLE_META },
    });
    void saveSessionsList(next);
    void saveActiveId(id);
    return id;
  },

  switchSession: (id) => {
    if (get().activeSessionId === id) return;
    if (!get().sessions.some((s) => s.id === id)) return;

    const flip = () => {
      set({ activeSessionId: id, agentMeta: IDLE_META });
      void saveActiveId(id);
    };
    if (chats.has(id) || seedMessages.has(id)) {
      flip();
      return;
    }
    void loadMessages(id).then((m) => {
      if (m && m.length > 0 && !chats.has(id)) seedMessages.set(id, m);
      flip();
    });
  },

  ensureSessionForScope: (scope) => {
    const existing = findActiveForScope(
      get().sessions,
      get().activeByScope,
      scope,
    );
    if (existing) return existing;
    return get().newSession(scope);
  },

  switchSessionForScope: (scope, id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session || !sessionMatchesScope(session, scope)) return;

    const activate = () => {
      const nextActiveByScope = {
        ...get().activeByScope,
        [scopeKey(scope)]: id,
      };
      set({
        activeSessionId: id,
        activeByScope: nextActiveByScope,
      });
      void saveActiveId(id);
      void saveActiveByScope(nextActiveByScope);
    };
    if (chats.has(id) || seedMessages.has(id)) {
      activate();
      return;
    }
    void loadMessages(id).then((m) => {
      if (m && m.length > 0 && !chats.has(id)) seedMessages.set(id, m);
      activate();
    });
  },

  getActiveSessionForScope: (scope: SessionScope) => {
    return findActiveForScope(get().sessions, get().activeByScope, scope);
  },

  deleteSession: (id) => {
    const deleted = get().sessions.find((s) => s.id === id);
    const remaining = get().sessions.filter((s) => s.id !== id);
    chats.get(id)?.stop();
    chats.delete(id);
    seedMessages.delete(id);
    const pend = pendingPersist.get(id);
    if (pend) {
      clearTimeout(pend.timer);
      pendingPersist.delete(id);
    }
    void deleteSessionData(id);
    void useTodosStore.getState().clearSession(id);

    const nextActiveByScope = pruneActiveByScope(get().activeByScope, remaining);
    if (deleted?.scope && get().activeByScope[scopeKey(deleted.scope)] === id) {
      delete nextActiveByScope[scopeKey(deleted.scope)];
    }

    const wasActive = get().activeSessionId === id;
    const nextActive = wasActive ? (remaining[0]?.id ?? null) : get().activeSessionId;
    const nextMetaBySession = { ...get().agentMetaBySession };
    delete nextMetaBySession[id];
    set({
      sessions: remaining,
      activeSessionId: nextActive,
      activeByScope: nextActiveByScope,
      agentMetaBySession: nextMetaBySession,
      ...(wasActive ? { agentMeta: IDLE_META } : {}),
    });
    void saveSessionsList(remaining);
    void saveActiveByScope(nextActiveByScope);
    if (wasActive) void saveActiveId(nextActive);
  },

  renameSession: (id, title) => {
    const next = get().sessions.map((s) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },

  persistMessages: (id, messages) => {
    // Debounce the message-blob write so streaming doesn't pound the store.
    const existing = pendingPersist.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const entry = pendingPersist.get(id);
      if (!entry) return;
      pendingPersist.delete(id);
      void saveMessages(id, entry.latest);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersist.set(id, { latest: messages, timer });

    // Update zustand session list only when the derived title actually
    // changes — otherwise we'd rewrite the sessions array (and trigger
    // re-renders + a store write) on every token.
    const sessions = get().sessions;
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const isUntitled = !meta.title || meta.title === "New chat";
    if (!isUntitled) return;
    const nextTitle = deriveTitle(messages);
    if (nextTitle === meta.title) return;
    const next = sessions.map((s) =>
      s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },
}));

export function getAgentMeta(): AgentMeta {
  return useChatStore.getState().agentMeta;
}

export function getActiveProviderKey(): string | null {
  const { selectedModelId, apiKeys, customEndpointKeys } = useChatStore.getState();
  if (isCompatModelId(selectedModelId)) {
    const eid = endpointIdFromCompatModel(selectedModelId);
    return customEndpointKeys[eid] ?? null;
  }
  return apiKeys[getModel(selectedModelId as ModelId).provider] ?? null;
}

export function hasKeyForModel(modelId: string): boolean {
  const { apiKeys } = useChatStore.getState();
  if (isCompatModelId(modelId)) {
    return true;
  }
  const provider = getModel(modelId as ModelId).provider;
  return providerNeedsKey(provider) ? !!apiKeys[provider] : true;
}

export function getChat(sessionId?: string): Chat<UIMessage> | undefined {
  if (sessionId) return chats.get(sessionId);
  const id = useChatStore.getState().activeSessionId;
  return id ? chats.get(id) : undefined;
}

export function stop(): void {
  const id = useChatStore.getState().activeSessionId;
  if (!id) return;
  void chats.get(id)?.stop();
}
