import { Chat, type UIMessage } from "@ai-sdk/react";
import {
  type ChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { getModel, isCompatModelId, providerNeedsKey, type ModelId } from "../config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { BUILTIN_AGENTS } from "../lib/agents";
import { scopeKey } from "../lib/sessions";
import { useAgentsStore } from "./agentsStore";
import { usePlanStore } from "./planStore";
import { createContextAwareTransport } from "../lib/transport";
import type { ToolContext } from "../tools/tools";
import {
  chats,
  getActiveProviderKey,
  seedMessages,
  touchChat,
  useChatStore,
} from "./chatStore";

function makeChat(sessionId: string): Chat<UIMessage> {
  const readCache = new Map<string, { size: number; hash: number }>();

  const getSessionScopeKey = (): string | null => {
    const session = useChatStore.getState().sessions.find((s) => s.id === sessionId);
    if (!session?.scope) return null;
    return scopeKey(session.scope);
  };

  /**
   * Extract leafId from scope keys like "terminal:42" or "terminal:42:ssh:<hostId>".
   * Returns null for non-terminal scopes.
   */
  const getScopeLeafId = (): number | null => {
    const sk = getSessionScopeKey();
    if (!sk?.startsWith("terminal:")) return null;
    // Take the first colon-delimited segment after "terminal:" so both
    // "terminal:42" and "terminal:42:ssh:<hostId>" parse correctly.
    const id = Number(sk.slice("terminal:".length).split(":")[0]);
    return Number.isFinite(id) ? id : null;
  };

  const toolContext: ToolContext = {
    getCwd: () => {
      const leafId = getScopeLeafId();
      const live = useChatStore.getState().live;
      return leafId != null ? live.getCwdForLeaf(leafId) : live.getCwd();
    },
    getWorkspaceRoot: () => useChatStore.getState().live.getWorkspaceRoot(),
    getTerminalContext: () => {
      const leafId = getScopeLeafId();
      const live = useChatStore.getState().live;
      return leafId != null
        ? live.getTerminalContextForLeaf(leafId)
        : live.getTerminalContext();
    },
    isActiveTerminalPrivate: () => {
      const leafId = getScopeLeafId();
      const live = useChatStore.getState().live;
      return leafId != null
        ? live.isTerminalPrivateForLeaf(leafId)
        : live.isActiveTerminalPrivate();
    },
    injectIntoActivePty: (text) => {
      const leafId = getScopeLeafId();
      const live = useChatStore.getState().live;
      return leafId != null
        ? live.injectIntoPtyForLeaf(leafId, text)
        : live.injectIntoActivePty(text);
    },
    getSshSessionId: () => {
      const leafId = getScopeLeafId();
      if (leafId == null) return null;
      return useChatStore.getState().live.getSshSessionIdForLeaf(leafId);
    },
    openPreview: (url) => useChatStore.getState().live.openPreview(url),
    spawnAgent: (prompt) =>
      useChatStore.getState().live.spawnManagedAgent(prompt, sessionId),
    readAgentOutput: (leafId) =>
      useChatStore.getState().live.readLeafBuffer(leafId),
    readCache,
    getSessionId: () => sessionId,
    getPermissionMode: () => {
      const sk = getSessionScopeKey();
      const state = useChatStore.getState();
      return sk ? state.getPermissionModeForScope(sk) : state.permissionMode;
    },
    getCommandBlocklist: () => useChatStore.getState().commandBlocklist,
    getWebSearchConfig: () => {
      const prefs = usePreferencesStore.getState();
      if (!prefs.webSearchEnabled) return null;
      return {
        provider: prefs.webSearchProvider,
        apiKey: null,
        maxResults: prefs.webSearchMaxResults,
        host: prefs.webSearchHost || null,
      };
    },
  };

  const transport = createContextAwareTransport({
    getKeys: () => useChatStore.getState().apiKeys,
    toolContext,
    getModelId: () => {
      const sk = getSessionScopeKey();
      const state = useChatStore.getState();
      return sk ? state.getSelectedModelForScope(sk) : state.selectedModelId;
    },
    getCustomInstructions: () =>
      usePreferencesStore.getState().customInstructions,
    getAgentPersona: () => {
      const sk = getSessionScopeKey();
      const agentsState = useAgentsStore.getState();
      const activeId = sk
        ? agentsState.getActiveIdForScope(sk)
        : agentsState.activeId;
      const all = [...BUILTIN_AGENTS, ...agentsState.customAgents];
      const a = all.find((x) => x.id === activeId) ?? BUILTIN_AGENTS[0];
      return { name: a.name, instructions: a.instructions };
    },
    getLive: () => {
      const live = useChatStore.getState().live;
      const leafId = getScopeLeafId();
      return {
        cwd: live.getCwd(),
        terminalPrivate: live.isActiveTerminalPrivate(),
        workspaceRoot: live.getWorkspaceRoot(),
        activeFile: live.getActiveFile(),
        scopeTerminalCwd: leafId != null ? live.getCwdForLeaf(leafId) : undefined,
        scopeTerminalPrivate: leafId != null ? live.isTerminalPrivateForLeaf(leafId) : undefined,
        scopeTerminalSsh: leafId != null ? live.isTerminalSshForLeaf(leafId) : undefined,
      };
    },
    getPlanMode: () => usePlanStore.getState().active,
    getReasoningEffort: () => {
      const sk = getSessionScopeKey();
      const state = useChatStore.getState();
      return sk ? state.getReasoningEffortForScope(sk) : state.reasoningEffort;
    },
    getLmstudioBaseURL: () => usePreferencesStore.getState().lmstudioBaseURL,
    getLmstudioModelIds: () => usePreferencesStore.getState().lmstudioModelIds,
    getMlxBaseURL: () => usePreferencesStore.getState().mlxBaseURL,
    getMlxModelIds: () => usePreferencesStore.getState().mlxModelIds,
    getOllamaBaseURL: () => usePreferencesStore.getState().ollamaBaseURL,
    getOllamaModelIds: () => usePreferencesStore.getState().ollamaModelIds,
    getOpenaiCompatibleBaseURL: () =>
      usePreferencesStore.getState().openaiCompatibleBaseURL,
    getOpenaiCompatibleModelId: () =>
      usePreferencesStore.getState().openaiCompatibleModelId,
    getOpenaiCompatibleContextLimit: () =>
      usePreferencesStore.getState().openaiCompatibleContextLimit,
    getOpenrouterModelIds: () =>
      usePreferencesStore.getState().openrouterModelIds,
    getCustomEndpoints: () => usePreferencesStore.getState().customEndpoints,
    getCustomEndpointKeys: () => useChatStore.getState().customEndpointKeys,
    onStep: (step) => {
      useChatStore.getState().patchAgentMetaForSession(sessionId, { step });
    },
    onCompact: (info) => {
      useChatStore.getState().patchAgentMetaForSession(sessionId, {
        compactionNotice: { droppedCount: info.droppedCount, at: Date.now() },
      });
    },
    onFinishMeta: (info) => {
      useChatStore
        .getState()
        .patchAgentMetaForSession(sessionId, { hitStepCap: info.hitStepCap });
    },
    onUsage: (delta) => {
      const cur = useChatStore.getState().getAgentMetaForSession(sessionId).tokens;
      useChatStore.getState().patchAgentMetaForSession(sessionId, {
        tokens: {
          inputTokens: cur.inputTokens + delta.inputTokens,
          outputTokens: cur.outputTokens + delta.outputTokens,
          cachedInputTokens: cur.cachedInputTokens + delta.cachedInputTokens,
        },
        lastInputTokens: delta.lastInputTokens,
        lastCachedTokens: delta.lastCachedTokens,
      });
    },
  }) as unknown as ChatTransport<UIMessage>;

  const initialMessages = seedMessages.get(sessionId);
  seedMessages.delete(sessionId);

  return new Chat<UIMessage>({
    id: sessionId,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (e) => {
      useChatStore.getState().patchAgentMetaForSession(sessionId, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    },
  });
}

export function getOrCreateChat(sessionId: string): Chat<UIMessage> {
  const existing = chats.get(sessionId);
  if (existing) {
    touchChat(sessionId, existing);
    return existing;
  }
  const c = makeChat(sessionId);
  touchChat(sessionId, c);
  return c;
}

export async function sendMessage(
  sessionId: string,
  text: string,
): Promise<boolean> {
  const state = useChatStore.getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  const sk = session?.scope ? scopeKey(session.scope) : null;
  const modelId = sk ? state.getSelectedModelForScope(sk) : state.selectedModelId;
  if (
    !isCompatModelId(modelId) &&
    providerNeedsKey(getModel(modelId as ModelId).provider) &&
    !getActiveProviderKey()
  )
    return false;
  state.patchAgentMetaForSession(sessionId, {
    hitStepCap: false,
    compactionNotice: null,
  });
  const c = getOrCreateChat(sessionId);
  await c.sendMessage({ text });
  return true;
}
