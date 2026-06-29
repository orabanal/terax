import { useEffect, useState } from "react";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import {
  MODELS,
  compatModelIdForEndpoint,
  indexedLocalModelId,
  type ProviderId,
} from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  getAllCustomEndpointKeys,
  getAllKeys,
  hasAnyKey,
} from "../lib/keyring";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";

/** Pick the first available model id from configured providers.
 *  Priority: cloud providers with keys > local providers > custom endpoints. */
function pickFirstAvailableModel(
  apiKeys: Record<string, string | null>,
  prefs: {
    lmstudioModelIds: string[];
    mlxModelIds: string[];
    ollamaModelIds: string[];
    openrouterModelIds: string[];
    customEndpoints: { id: string; baseURL: string; modelIds: string[] }[];
  },
): string | null {
  // Cloud providers: first one with a key
  const cloudOrder: ProviderId[] = [
    "anthropic",
    "openai",
    "google",
    "xai",
    "deepseek",
    "mistral",
    "cerebras",
    "groq",
  ];
  for (const pid of cloudOrder) {
    if (apiKeys[pid]) {
      const m = MODELS.find((x) => x.provider === pid);
      if (m) return m.id;
    }
  }
  // Local providers: first one with models configured
  const locals: { provider: ProviderId; ids: string[] }[] = [
    { provider: "lmstudio", ids: prefs.lmstudioModelIds },
    { provider: "mlx", ids: prefs.mlxModelIds },
    { provider: "ollama", ids: prefs.ollamaModelIds },
    { provider: "openrouter", ids: prefs.openrouterModelIds },
  ];
  for (const { provider, ids } of locals) {
    if (ids.length > 0) return indexedLocalModelId(provider, 0);
  }
  // Custom endpoints: first one with models
  for (const ep of prefs.customEndpoints) {
    if (ep.baseURL.trim() && ep.modelIds.length > 0)
      return compatModelIdForEndpoint(ep.id, 0);
  }
  return null;
}

/**
 * Startup wiring for the AI subsystem: loads provider keys (and keeps them in
 * sync), hydrates the preference store, auto-selects the first available
 * model, hydrates chat/agents/snippets stores, and fires any pending review
 * for the active session. Returns the two derived flags the shell needs.
 */
export function useAiBootstrap(): {
  hasComposer: boolean;
  keysLoaded: boolean;
} {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const lmstudioModelIds = usePreferencesStore((s) => s.lmstudioModelIds);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelIds = usePreferencesStore((s) => s.mlxModelIds);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelIds = usePreferencesStore((s) => s.ollamaModelIds);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const hasLocalModel =
    (lmstudioBaseURL.trim().length > 0 && lmstudioModelIds.length > 0) ||
    (mlxBaseURL.trim().length > 0 && mlxModelIds.length > 0) ||
    (ollamaBaseURL.trim().length > 0 && ollamaModelIds.length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    customEndpoints.some(
      (e) => e.baseURL.trim().length > 0 && e.modelIds.length > 0,
    );
  const hasComposer = hasAnyKey(apiKeys) || hasLocalModel;

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
      if (!prefsHydrated) return;
      void getAllCustomEndpointKeys(
        usePreferencesStore.getState().customEndpoints,
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys, prefsHydrated]);

  // Hydrate the cross-window preference store and auto-select the first
  // available model from configured providers.
  const initPrefs = usePreferencesStore((s) => s.init);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    const state = usePreferencesStore.getState();
    const modelId = pickFirstAvailableModel(apiKeys, state);
    if (modelId) setSelectedModelId(modelId);
  }, [prefsHydrated, apiKeys, setSelectedModelId]);

  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, [hydrateSessions]);

  return { hasComposer, keysLoaded };
}
