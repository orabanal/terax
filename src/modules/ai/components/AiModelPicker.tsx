import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  ArrowDown01Icon,
  CpuIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useMemo } from "react";
import {
  MODELS,
  compatModelIdForEndpoint,
  getCompatModelInfo,
  indexedLocalModelId,
  providerNeedsKey,
  resolveModel,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { useChatStore } from "../store/chatStore";

/** Provider ids that use the local model id scheme (user-supplied model names). */
const LOCAL_PROVIDER_IDS = [
  "lmstudio",
  "mlx",
  "ollama",
  "openrouter",
] as const;

type LocalProviderId = (typeof LOCAL_PROVIDER_IDS)[number];

type Props = {
  selectedModelId: string;
  onSelect: (id: string) => void;
};

export const AiModelPicker = memo(function AiModelPicker({
  selectedModelId,
  onSelect,
}: Props) {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const lmstudioModelIds = usePreferencesStore((s) => s.lmstudioModelIds);
  const mlxModelIds = usePreferencesStore((s) => s.mlxModelIds);
  const ollamaModelIds = usePreferencesStore((s) => s.ollamaModelIds);
  const openrouterModelIds = usePreferencesStore((s) => s.openrouterModelIds);

  const localModelIds = useMemo(
    (): Record<LocalProviderId, string[]> => ({
      lmstudio: lmstudioModelIds,
      mlx: mlxModelIds,
      ollama: ollamaModelIds,
      openrouter: openrouterModelIds,
    }),
    [lmstudioModelIds, mlxModelIds, ollamaModelIds, openrouterModelIds],
  );

  const configuredProviders = useMemo((): Set<ProviderId> => {
    const set = new Set<ProviderId>();
    for (const m of MODELS) {
      const pid = m.provider;
      if (pid === "openai-compatible") continue;
      if (set.has(pid)) continue;
      if (providerNeedsKey(pid)) {
        if (apiKeys[pid]) set.add(pid);
      } else if (pid === "openrouter") {
        if (apiKeys.openrouter || openrouterModelIds.length > 0) set.add(pid);
      } else if (pid === "lmstudio") {
        if (lmstudioModelIds.length > 0) set.add(pid);
      } else if (pid === "mlx") {
        if (mlxModelIds.length > 0) set.add(pid);
      } else if (pid === "ollama") {
        if (ollamaModelIds.length > 0) set.add(pid);
      }
    }
    return set;
  }, [apiKeys, lmstudioModelIds, mlxModelIds, ollamaModelIds, openrouterModelIds]);

  const availableModels = useMemo((): ModelInfo[] => {
    const result: ModelInfo[] = [];
    // Cloud provider models from the hardcoded registry
    for (const m of MODELS) {
      if (m.provider === "openai-compatible") continue;
      if (
        configuredProviders.has(m.provider) &&
        !(LOCAL_PROVIDER_IDS as readonly string[]).includes(m.provider)
      ) {
        result.push(m);
      }
    }
    // Local provider models (indexed)
    for (const pid of LOCAL_PROVIDER_IDS) {
      if (!configuredProviders.has(pid as ProviderId)) continue;
      const ids = localModelIds[pid as LocalProviderId] ?? [];
      for (let i = 0; i < ids.length; i++) {
        result.push({
          id: indexedLocalModelId(pid, i),
          provider: pid,
          label: ids[i],
          hint: "Local",
          description: `Local model on ${pid}`,
          capabilities: { intelligence: 3, speed: 3, cost: 5 },
        });
      }
    }
    // Custom endpoint models (indexed)
    for (const ep of customEndpoints) {
      for (let i = 0; i < (ep.modelIds?.length ?? 0); i++) {
        result.push(
          getCompatModelInfo(
            compatModelIdForEndpoint(ep.id, i),
            customEndpoints,
          ),
        );
      }
    }
    return result;
  }, [configuredProviders, customEndpoints, localModelIds]);

  // Resolve display label for the selected model.
  const current = useMemo(
    () => resolveModel(selectedModelId, customEndpoints, localModelIds),
    [selectedModelId, customEndpoints, localModelIds],
  );

  const currentInList = availableModels.some((m) => m.id === selectedModelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[10.5px] text-foreground/72 hover:bg-muted/24 transition-colors"
          title={`Model: ${current.label}`}
        >
          <HugeiconsIcon icon={CpuIcon} size={11} strokeWidth={1.75} className="text-muted-foreground/64" />
          <span className="max-w-[82px] truncate">{current.label}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={9}
            strokeWidth={2}
            className="text-muted-foreground/50"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-56 overflow-y-auto"
      >
        {!currentInList && (
          <DropdownMenuItem
            onSelect={() => onSelect(selectedModelId)}
            className="flex items-center gap-2 text-[11px] bg-accent/40"
          >
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {current.hint}
            </span>
            <HugeiconsIcon
              icon={Tick01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 text-foreground"
            />
          </DropdownMenuItem>
        )}
        {availableModels.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onSelect(m.id)}
            className={cn(
              "flex items-center gap-2 text-[11px]",
              m.id === selectedModelId && "bg-accent/40",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {m.hint}
            </span>
            {m.id === selectedModelId ? (
              <HugeiconsIcon
                icon={Tick01Icon}
                size={12}
                strokeWidth={2}
                className="shrink-0 text-foreground"
              />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
