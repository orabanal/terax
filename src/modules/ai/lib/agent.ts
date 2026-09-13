import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  getModelContextLimit,
  isCompatModelId,
  LMSTUDIO_DEFAULT_BASE_URL,
  MAX_AGENT_STEPS,
  mergeProviderOptions,
  MLX_DEFAULT_BASE_URL,
  modelKeepsReasoning,
  normalizeCompatBaseURL,
  OLLAMA_DEFAULT_BASE_URL,
  parseCompatModelId,
  parseIndexedLocalModelId,
  providerNeedsKey,
  resolveCompatApi,
  resolveEffectiveProvider,
  resolveModel,
  selectSystemPrompt,
  type CustomEndpoint,
  type CustomEndpointApi,
  type ProviderId,
} from "../config";
import { version as TERAX_VERSION } from "../../../../package.json";
import type { ReasoningEffort } from "../store/chatStore";
import { buildTools, type ToolContext } from "../tools/tools";
import { compactModelMessagesDetailed } from "./compact";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> =
  {
    read_file: (i) => `Reading ${shortPath(i.path)}`,
    list_directory: (i) => `Listing ${shortPath(i.path)}`,
    grep: (i) => `Grepping ${ellipsize(String(i.pattern ?? ""), 40)}`,
    glob: (i) => `Globbing ${ellipsize(String(i.pattern ?? ""), 40)}`,
    edit: (i) => `Editing ${shortPath(i.path)}`,
    multi_edit: (i) => `Editing ${shortPath(i.path)}`,
    write_file: (i) => `Writing ${shortPath(i.path)}`,
    create_directory: (i) => `Creating ${shortPath(i.path)}`,
    bash_run: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
    ssh_run: (i) => `Running on server: ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_background: (i) =>
      `Spawning ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_logs: () => `Reading logs`,
    bash_list: () => `Listing background processes`,
    bash_kill: () => `Stopping background process`,
    suggest_command: (i) =>
      `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
    todo_write: (i) =>
      `Updating plan (${Array.isArray(i.todos) ? i.todos.length : 0} items)`,
    run_subagent: (i) => `Spawning ${String(i.type ?? "subagent")} subagent`,
  };

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type BuildModelOptions = {
  modelIdOverride?: string;
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleHeaders?: Record<string, string>;
  openaiCompatibleApi?: CustomEndpointApi | "auto";
  /** Stable id per conversation — sent as `x-opencode-session` so gateways
   *  like OpenCode Go can route + cache efficiently. */
  sessionId?: string;
};

const TERAX_USER_AGENT = `Terax/${TERAX_VERSION}`;

const modelCache = new Map<string, LanguageModel>();
// The cache key includes the chat session id, so entries accumulate as
// sessions come and go. Cap it LRU-style like the chat registry in
// chatStore (CHATS_LRU_CAP).
const MODEL_CACHE_CAP = 20;

export async function buildLanguageModel(
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
  customEndpointKey?: string | null,
): Promise<LanguageModel> {
  if (providerNeedsKey(provider) && !keys[provider]) {
    throw new Error(
      `No API key configured for ${provider}. Open Settings → AI to add one.`,
    );
  }
  const key = keys[provider] ?? "";
  const lmstudioURL = options.lmstudioBaseURL ?? LMSTUDIO_DEFAULT_BASE_URL;
  const mlxURL = options.mlxBaseURL ?? MLX_DEFAULT_BASE_URL;
  const ollamaURL = options.ollamaBaseURL ?? OLLAMA_DEFAULT_BASE_URL;
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const compatHeaders = options.openaiCompatibleHeaders ?? {};
  const compatApi = resolveCompatApi(compatURL, options.openaiCompatibleApi);
  const sessionId = options.sessionId?.trim() ?? "";
  const epKey = customEndpointKey ?? "";
  const cacheKey = `${provider} ${key} ${epKey} ${resolvedModelId} ${lmstudioURL} ${mlxURL} ${ollamaURL} ${compatURL} ${compatApi} ${sessionId} ${JSON.stringify(compatHeaders)}`;
  const hit = modelCache.get(cacheKey);
  if (hit) {
    modelCache.delete(cacheKey);
    modelCache.set(cacheKey, hit);
    return hit;
  }

  let built: LanguageModel;
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      built = createOpenAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      built = createAnthropic({ apiKey: key })(resolvedModelId);
      break;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      built = createGoogleGenerativeAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      built = createXai({ apiKey: key })(resolvedModelId);
      break;
    }
    case "cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      built = createCerebras({ apiKey: key })(resolvedModelId);
      break;
    }
    case "deepseek": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "mistral": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "mistral",
        baseURL: "https://api.mistral.ai/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      built = createGroq({ apiKey: key })(resolvedModelId);
      break;
    }
    case "openrouter": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        headers: {
          "HTTP-Referer": "https://terax.ai",
          "X-Title": "Terax",
        },
      })(resolvedModelId);
      break;
    }
    case "openai-compatible": {
      if (!compatURL) {
        throw new Error(
          "OpenAI-compatible provider has no base URL. Set it in Settings → Models.",
        );
      }
      // Custom headers configured per endpoint + a stable session id.
      // OpenCode Go (Console Go) *requires* `x-opencode-session` for routing;
      // without it requests fail with "missing x-opencode-session". We always
      // send it when we know the conversation id, and let an explicit custom
      // header override it. A distinct User-Agent identifies Terax instead of
      // a generic SDK name, as recommended by OpenCode Go docs.
      const headers: Record<string, string> = {
        "User-Agent": TERAX_USER_AGENT,
        ...compatHeaders,
      };
      if (sessionId && !headers["x-opencode-session"]) {
        headers["x-opencode-session"] = sessionId;
      }
      // The stored URL may be the full REST path from a provider table
      // (…/chat/completions, …/responses, …/messages); SDKs want the …/v1 prefix.
      const prefix = normalizeCompatBaseURL(compatURL);
      if (compatApi === "responses") {
        const { createOpenAI } = await import("@ai-sdk/openai");
        // createOpenAI defaults to the Responses API: base …/v1 → POST …/v1/responses.
        built = createOpenAI({
          baseURL: prefix,
          apiKey: epKey || key || undefined,
          headers,
          fetch: localProxyFetch,
        })(resolvedModelId);
      } else if (compatApi === "messages") {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        // Go-style gateways expect Bearer auth; native Anthropic expects
        // x-api-key. Send both so either side accepts the key.
        const authHeaders = { ...headers };
        const bearer = epKey || key || "";
        if (bearer && !authHeaders["x-api-key"]) {
          authHeaders["x-api-key"] = bearer;
        }
        built = createAnthropic({
          baseURL: prefix,
          authToken: bearer || undefined,
          headers: authHeaders,
          fetch: localProxyFetch,
        })(resolvedModelId);
      } else {
        const { createOpenAICompatible } =
          await import("@ai-sdk/openai-compatible");
        built = createOpenAICompatible({
          name: "openai-compatible",
          baseURL: prefix,
          apiKey: epKey || key || undefined,
          headers,
          fetch: localProxyFetch,
        })(resolvedModelId);
      }
      break;
    }
    case "lmstudio": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "lmstudio",
        baseURL: lmstudioURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    case "mlx": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "mlx",
        baseURL: mlxURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    case "ollama": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "ollama",
        baseURL: ollamaURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
  modelCache.set(cacheKey, built);
  while (modelCache.size > MODEL_CACHE_CAP) {
    const oldest = modelCache.keys().next().value;
    if (oldest === undefined) break;
    modelCache.delete(oldest);
  }
  return built;
}

export type LocalProviderConfig = {
  lmstudioBaseURL?: string;
  lmstudioModelIds?: string[];
  mlxBaseURL?: string;
  mlxModelIds?: string[];
  ollamaBaseURL?: string;
  ollamaModelIds?: string[];
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleHeaders?: Record<string, string>;
  openaiCompatibleApi?: CustomEndpointApi | "auto";
  openrouterModelIds?: string[];
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  sessionId?: string;
};

export function buildConfiguredLanguageModel(
  modelId: string,
  keys: ProviderKeys,
  local: LocalProviderConfig = {},
): Promise<LanguageModel> {
  // Indexed compat models: compat-{endpointId}-{modelIndex}
  if (isCompatModelId(modelId)) {
    const parsed = parseCompatModelId(modelId);
    if (!parsed) throw new Error(`Invalid compat model id: ${modelId}`);
    const ep = local.customEndpoints?.find((e) => e.id === parsed.endpointId);
    if (!ep) throw new Error(`Custom endpoint not found: ${parsed.endpointId}`);
    const resolvedModelId = ep.modelIds?.[parsed.modelIndex]?.trim();
    if (!resolvedModelId) {
      throw new Error(
        `${ep.name}: model at index ${parsed.modelIndex} not found. Open Settings → Models.`,
      );
    }
    return buildLanguageModel(
      "openai-compatible",
      keys,
      resolvedModelId,
      {
        openaiCompatibleBaseURL: ep.baseURL,
        openaiCompatibleHeaders: ep.headers,
        openaiCompatibleApi: ep.api,
        sessionId: local.sessionId,
      },
      local.customEndpointKeys?.[parsed.endpointId],
    );
  }

  // Indexed local provider models: {provider}-local-{modelIndex}
  const indexedLocal = parseIndexedLocalModelId(modelId);
  if (indexedLocal) {
    const { provider, modelIndex } = indexedLocal;
    const modelIds =
      provider === "lmstudio"
        ? local.lmstudioModelIds
        : provider === "mlx"
          ? local.mlxModelIds
          : provider === "ollama"
            ? local.ollamaModelIds
            : provider === "openrouter"
              ? local.openrouterModelIds
              : undefined;
    const resolvedModelId = modelIds?.[modelIndex]?.trim();
    if (!resolvedModelId) {
      throw new Error(
        `${provider}: model at index ${modelIndex} not found. Open Settings → Models.`,
      );
    }
    return buildLanguageModel(provider as ProviderId, keys, resolvedModelId, {
      lmstudioBaseURL: local.lmstudioBaseURL,
      mlxBaseURL: local.mlxBaseURL,
      ollamaBaseURL: local.ollamaBaseURL,
      openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
    });
  }

  // Legacy non-indexed placeholders (kept for backward compat)
  const m = resolveModel(modelId);
  let resolvedId: string = m.id;
  if (m.id === "lmstudio-local") {
    const first = local.lmstudioModelIds?.[0]?.trim();
    if (!first) {
      throw new Error(
        "LM Studio: no model id set. Open Settings → Models and enter the model id loaded in LM Studio.",
      );
    }
    resolvedId = first;
  } else if (m.id === "mlx-local") {
    const first = local.mlxModelIds?.[0]?.trim();
    if (!first) {
      throw new Error(
        "MLX: no model id set. Open Settings → Models and enter the model id served by mlx_lm.server.",
      );
    }
    resolvedId = first;
  } else if (m.id === "ollama-local") {
    const first = local.ollamaModelIds?.[0]?.trim();
    if (!first) {
      throw new Error(
        "Ollama: no model id set. Open Settings → Models and enter the model id (e.g. the name from `ollama list`).",
      );
    }
    resolvedId = first;
  } else if (m.id === "openai-compatible-custom") {
    if (!local.openaiCompatibleModelId?.trim()) {
      throw new Error(
        "OpenAI-compatible: no model id set. Open Settings → Models.",
      );
    }
    resolvedId = local.openaiCompatibleModelId.trim();
  } else if (m.id === "openrouter-custom") {
    const first = local.openrouterModelIds?.[0]?.trim();
    if (!first) {
      throw new Error(
        "OpenRouter: no model id set. Open Settings → Models and enter an OpenRouter model id (e.g. anthropic/claude-sonnet-4-6).",
      );
    }
    resolvedId = first;
  }
  return buildLanguageModel(m.provider, keys, resolvedId, {
    lmstudioBaseURL: local.lmstudioBaseURL,
    mlxBaseURL: local.mlxBaseURL,
    ollamaBaseURL: local.ollamaBaseURL,
    openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
    openaiCompatibleHeaders: local.openaiCompatibleHeaders,
    openaiCompatibleApi: local.openaiCompatibleApi,
    sessionId: local.sessionId,
  });
}

const PLAN_MODE_PROMPT = `## PLAN MODE — ACTIVE
Mutating tools (write_file, edit, multi_edit, create_directory) will queue their changes for the user to review as a single diff. Do NOT execute bash_run or bash_background while plan mode is active — restrict yourself to reads (read_file, grep, glob, list_directory) and the queued mutations. After queueing the full set of edits, stop and return a brief summary; do not continue acting until the user has accepted/rejected.`;

function buildStableSystem(
  modelId: string,
  persona: { name: string; instructions: string } | null,
  customInstructions: string | undefined,
  projectMemory: string | null,
): string {
  const base = selectSystemPrompt(modelId);
  const personaBlock = persona?.instructions.trim()
    ? `\n\n## ACTIVE AGENT — ${persona.name}\n${persona.instructions.trim()}`
    : "";
  const customBlock = customInstructions?.trim()
    ? `\n\n## USER CUSTOM INSTRUCTIONS — follow unless they conflict with safety rules above\n${customInstructions.trim()}`
    : "";
  const memoryBlock =
    projectMemory && projectMemory.trim().length > 0
      ? `\n\n## PROJECT — TERAX.md\n${projectMemory.trim()}`
      : "";
  return `${base}${memoryBlock}${personaBlock}${customBlock}`;
}

// OpenAI / Gemini / DeepSeek apply prefix caching automatically; only
// Anthropic needs explicit breakpoints. Mark the stable system prefix and
// the rotating conversation tail.
function applyCacheBreakpoints(
  messages: ModelMessage[],
  provider: ProviderId,
): ModelMessage[] {
  if (provider !== "anthropic" || messages.length === 0) return messages;
  const marker = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
  };
  const withMarker = (m: ModelMessage): ModelMessage => ({
    ...m,
    providerOptions: { ...(m.providerOptions ?? {}), ...marker },
  });
  const out = messages.slice();
  out[0] = withMarker(out[0]);
  const lastIdx = out.length - 1;
  if (lastIdx > 0) out[lastIdx] = withMarker(out[lastIdx]);
  return out;
}

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AgentUsageDelta = AgentUsage & {
  lastInputTokens: number;
  lastCachedTokens: number;
};

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

export type RunAgentOptions = {
  keys: ProviderKeys;
  modelId?: string;
  customInstructions?: string;
  agentPersona?: { name: string; instructions: string } | null;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onFinishMeta?: (info: { hitStepCap: boolean; finishReason: string }) => void;
  lmstudioBaseURL?: string;
  lmstudioModelIds?: string[];
  mlxBaseURL?: string;
  mlxModelIds?: string[];
  ollamaBaseURL?: string;
  ollamaModelIds?: string[];
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleContextLimit?: number;
  openaiCompatibleHeaders?: Record<string, string>;
  openaiCompatibleApi?: CustomEndpointApi | "auto";
  openrouterModelIds?: string[];
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  /** Chat conversation id — forwarded as `x-opencode-session`. */
  sessionId?: string;
  planMode?: boolean;
  reasoningEffort?: ReasoningEffort;
  projectMemory?: string | null;
  uiMessages: UIMessage[];
  abortSignal?: AbortSignal;
};

function buildReasoningProviderOptions(
  effort: ReasoningEffort,
  provider: ProviderId,
  // biome-ignore lint/suspicious/noExplicitAny: provider options are provider-specific JSON
): Record<string, Record<string, any>> | undefined {
  if (effort === "auto") return undefined;

  if (effort === "none") {
    switch (provider) {
      case "openai":
        return { openai: { reasoningEffort: "none" } };
      case "anthropic":
        return { anthropic: { thinking: { type: "disabled" } } };
      case "google":
        return { google: { thinkingConfig: { thinkingBudget: 0 } } };
      default:
        return undefined;
    }
  }

  // low / medium / high
  switch (provider) {
    case "openai":
      return { openai: { reasoningEffort: effort } };
    case "anthropic": {
      const budget =
        effort === "low" ? 2048 : effort === "medium" ? 8192 : 32768;
      return {
        anthropic: { thinking: { type: "enabled", budgetTokens: budget } },
      };
    }
    case "google":
      return { google: { thinkingConfig: { thinkingLevel: effort } } };
    case "xai":
      return { xai: { reasoningEffort: effort === "low" ? "low" : "high" } };
    default:
      return undefined;
  }
}

export async function runAgentStream(opts: RunAgentOptions) {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const model = await buildConfiguredLanguageModel(modelId, opts.keys, {
    lmstudioBaseURL: opts.lmstudioBaseURL,
    lmstudioModelIds: opts.lmstudioModelIds,
    mlxBaseURL: opts.mlxBaseURL,
    mlxModelIds: opts.mlxModelIds,
    ollamaBaseURL: opts.ollamaBaseURL,
    ollamaModelIds: opts.ollamaModelIds,
    openaiCompatibleBaseURL: opts.openaiCompatibleBaseURL,
    openaiCompatibleModelId: opts.openaiCompatibleModelId,
    openaiCompatibleHeaders: opts.openaiCompatibleHeaders,
    openaiCompatibleApi: opts.openaiCompatibleApi,
    openrouterModelIds: opts.openrouterModelIds,
    customEndpoints: opts.customEndpoints,
    customEndpointKeys: opts.customEndpointKeys,
    sessionId: opts.sessionId,
  });
  const endpoints = opts.customEndpoints ?? [];
  const info = resolveModel(modelId, endpoints);
  const compatEndpoint = isCompatModelId(modelId)
    ? endpoints.find((e) => e.id === parseCompatModelId(modelId)?.endpointId)
    : undefined;
  const compatApi = compatEndpoint
    ? resolveCompatApi(compatEndpoint.baseURL, compatEndpoint.api)
    : undefined;
  const provider = resolveEffectiveProvider(modelId, endpoints, info.provider);

  const stableSystem = buildStableSystem(
    modelId,
    opts.agentPersona ?? null,
    opts.customInstructions,
    opts.projectMemory ?? null,
  );

  const history = await convertToModelMessages(opts.uiMessages);
  const keepsReasoning = modelKeepsReasoning(info);
  const prunedHistory = pruneMessages({
    messages: history,
    reasoning: keepsReasoning ? "none" : "before-last-message",
    emptyMessages: "remove",
  });
  const compatCtxOverride = compatEndpoint?.contextLimit
    ?? (isCompatModelId(modelId) ? undefined : opts.openaiCompatibleContextLimit);
  const compact = compactModelMessagesDetailed(
    prunedHistory,
    getModelContextLimit(modelId, compatCtxOverride),
  );
  const compactedHistory = compact.messages;
  if (compact.compacted) {
    opts.onCompact?.({ droppedCount: compact.droppedCount });
  }

  const messages: ModelMessage[] = [{ role: "system", content: stableSystem }];
  if (opts.planMode) {
    messages.push({ role: "system", content: PLAN_MODE_PROMPT });
  }
  messages.push(...compactedHistory);

  const finalMessages = applyCacheBreakpoints(messages, provider);

  const reasoningOpts = buildReasoningProviderOptions(
    opts.reasoningEffort ?? "auto",
    provider,
  );
  // Responses gateways that translate to another upstream (OpenCode Go →
  // Meta and friends) have been observed rejecting continued tool steps with
  // "No function call found for function call output": they reconcile the
  // follow-up against stored server state instead of the request input.
  // Force self-contained requests. Side benefit: prompts aren't retained
  // server-side for the multi-step loop.
  const responsesOpts =
    compatApi === "responses" ? { openai: { store: false } } : undefined;
  const providerOptions = mergeProviderOptions(responsesOpts, reasoningOpts);

  let stepsSeen = 0;
  return streamText({
    model,
    messages: finalMessages,
    tools: buildTools(opts.toolContext),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    abortSignal: opts.abortSignal,
    ...(providerOptions
      ? { providerOptions: providerOptions as Parameters<typeof streamText>[0]["providerOptions"] }
      : {}),
    onStepFinish: (step) => {
      stepsSeen++;
      if (opts.onStep) {
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) {
          const label = TOOL_LABELS[last.toolName];
          opts.onStep(
            label
              ? label((last.input ?? {}) as Record<string, unknown>)
              : `Calling ${last.toolName}`,
          );
        } else if (step.text) {
          opts.onStep("Writing");
        }
      }
      if (opts.onUsage && step.usage) {
        const u = step.usage;
        const stepInput = u.inputTokens ?? 0;
        const stepCached = u.inputTokenDetails?.cacheReadTokens ?? 0;
        opts.onUsage({
          inputTokens: stepInput,
          outputTokens: u.outputTokens ?? 0,
          cachedInputTokens: stepCached,
          lastInputTokens: stepInput,
          lastCachedTokens: stepCached,
        });
      }
    },
    onFinish: (result) => {
      opts.onStep?.(null);
      const finishReason =
        (result as { finishReason?: string } | undefined)?.finishReason ?? "";
      opts.onFinishMeta?.({
        hitStepCap: stepsSeen >= MAX_AGENT_STEPS,
        finishReason,
      });
    },
  });
}

export { EMPTY_USAGE };
