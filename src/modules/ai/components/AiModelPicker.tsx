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
  AppleIcon,
  ArrowDown01Icon,
  ChatGptIcon,
  ClaudeIcon,
  ComputerIcon,
  CpuIcon,
  DeepseekIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  MistralIcon,
  PlugIcon,
  ServerStack01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useMemo } from "react";
import {
  MODELS,
  PROVIDERS,
  compatModelIdForEndpoint,
  getCompatModelInfo,
  indexedLocalModelId,
  providerNeedsKey,
  resolveModel,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { useChatStore } from "../store/chatStore";

const PROVIDER_ICON: Record<ProviderId, typeof CpuIcon> = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
};

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

  // Grouped models: provider label -> ModelInfo[]
  const groups = useMemo((): { label: string; icon: typeof CpuIcon; models: ModelInfo[] }[] => {
    const result: { label: string; icon: typeof CpuIcon; models: ModelInfo[] }[] = [];

    // Cloud providers
    for (const p of PROVIDERS) {
      if (p.id === "openai-compatible") continue;
      if ((LOCAL_PROVIDER_IDS as readonly string[]).includes(p.id)) continue;
      const hasKey = providerNeedsKey(p.id) ? !!apiKeys[p.id] : true;
      if (!hasKey) continue;
      const models = MODELS.filter((m) => m.provider === p.id);
      if (models.length > 0) {
        result.push({ label: p.label, icon: PROVIDER_ICON[p.id], models });
      }
    }

    // Local providers
    for (const pid of LOCAL_PROVIDER_IDS) {
      const ids = localModelIds[pid as LocalProviderId] ?? [];
      if (ids.length === 0) continue;
      const p = PROVIDERS.find((x) => x.id === pid);
      const models: ModelInfo[] = ids.map((id, i) => ({
        id: indexedLocalModelId(pid, i),
        provider: pid as ProviderId,
        label: id,
        hint: "Local",
        description: `Local model on ${p?.label ?? pid}`,
        capabilities: { intelligence: 3, speed: 3, cost: 5 },
      }));
      result.push({ label: p?.label ?? pid, icon: PROVIDER_ICON[pid as ProviderId], models });
    }

    // Custom endpoints
    for (const ep of customEndpoints) {
      if (!ep.modelIds?.length) continue;
      const models: ModelInfo[] = [];
      for (let i = 0; i < ep.modelIds.length; i++) {
        models.push(
          getCompatModelInfo(compatModelIdForEndpoint(ep.id, i), customEndpoints),
        );
      }
      result.push({
        label: ep.name || "Custom endpoint",
        icon: PROVIDER_ICON["openai-compatible"],
        models,
      });
    }

    return result;
  }, [apiKeys, customEndpoints, localModelIds]);

  const flatModels = useMemo(() => groups.flatMap((g) => g.models), [groups]);

  const current = useMemo(
    () => resolveModel(selectedModelId, customEndpoints, localModelIds),
    [selectedModelId, customEndpoints, localModelIds],
  );

  // Find provider label for the selected model.
  const currentProviderLabel = useMemo(() => {
    for (const g of groups) {
      if (g.models.some((m) => m.id === selectedModelId)) return g.label;
    }
    return null;
  }, [groups, selectedModelId]);

  const currentInList = flatModels.some((m) => m.id === selectedModelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[10.5px] text-foreground/72 hover:bg-muted/24 transition-colors"
          title={`${currentProviderLabel ?? ""} / ${current.label}`}
        >
          <HugeiconsIcon icon={CpuIcon} size={11} strokeWidth={1.75} className="text-muted-foreground/64" />
          {currentProviderLabel && (
            <>
              <span className="max-w-[64px] truncate text-muted-foreground/50">{currentProviderLabel}</span>
              <span className="text-muted-foreground/30">/</span>
            </>
          )}
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
        className="max-h-80 w-64 overflow-y-auto py-1"
      >
        {!currentInList && (
          <DropdownMenuItem
            onSelect={() => onSelect(selectedModelId)}
            className="flex items-center gap-2 text-[11px] bg-accent/40"
          >
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            <HugeiconsIcon
              icon={Tick01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 text-foreground"
            />
          </DropdownMenuItem>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
              <HugeiconsIcon
                icon={g.icon}
                size={12}
                strokeWidth={1.5}
                className="shrink-0 text-muted-foreground/60"
              />
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase">
                {g.label}
              </span>
            </div>
            {g.models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => onSelect(m.id)}
                className={cn(
                  "flex items-center gap-2 pl-7 text-[11px]",
                  m.id === selectedModelId && "bg-accent/40",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
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
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
