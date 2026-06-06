import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SearchProviderId } from "@/modules/ai/lib/searchKeyring";
import {
  clearSearchKey,
  getSearchKey,
  setSearchKey,
} from "@/modules/ai/lib/searchKeyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setWebSearchEnabled,
  setWebSearchHost,
  setWebSearchMaxResults,
  setWebSearchProvider,
} from "@/modules/settings/store";
import { CheckmarkCircle02Icon, GlobalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const PROVIDERS: { id: SearchProviderId; label: string; needsKey: boolean; needsHost: boolean }[] = [
  { id: "tavily", label: "Tavily", needsKey: true, needsHost: false },
  { id: "exa", label: "Exa", needsKey: true, needsHost: false },
  { id: "bocha", label: "Bocha", needsKey: true, needsHost: false },
  { id: "zhipu", label: "Zhipu AI", needsKey: true, needsHost: false },
  { id: "searxng", label: "SearXNG", needsKey: false, needsHost: true },
];

export function WebSearchSection() {
  const enabled = usePreferencesStore((s) => s.webSearchEnabled);
  const provider = usePreferencesStore((s) => s.webSearchProvider);
  const maxResults = usePreferencesStore((s) => s.webSearchMaxResults);
  const host = usePreferencesStore((s) => s.webSearchHost);

  const [apiKey, setApiKeyState] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);

  const currentProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  useEffect(() => {
    if (!currentProvider.needsKey) {
      setApiKeyState("");
      setKeySaved(false);
      return;
    }
    setKeyLoading(true);
    void getSearchKey(provider).then((k) => {
      setApiKeyState(k ?? "");
      setKeySaved(!!k);
      setKeyLoading(false);
    });
  }, [provider, currentProvider.needsKey]);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      await clearSearchKey(provider);
      setKeySaved(false);
      return;
    }
    await setSearchKey(provider, apiKey.trim());
    setKeySaved(true);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Web Search"
        description="Enable the agent to search the web for current information."
      />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-foreground">Enable web search</p>
          <p className="text-[11px] text-muted-foreground">
            The agent can call web_search when it needs current information.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setWebSearchEnabled(v)}
        />
      </div>

      <div className={cn("space-y-4", !enabled && "pointer-events-none opacity-50")}>
        <div className="space-y-1.5">
          <p className="text-[11.5px] font-medium text-foreground">Provider</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void setWebSearchProvider(p.id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] transition-colors",
                  provider === p.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={GlobalIcon} size={11} strokeWidth={1.75} />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {currentProvider.needsKey && (
          <div className="space-y-1.5">
            <label htmlFor="ws-api-key" className="text-[11.5px] font-medium text-foreground">
              {currentProvider.label} API key
            </label>
            <div className="flex gap-2">
              <Input
                id="ws-api-key"
                type="password"
                value={keyLoading ? "" : apiKey}
                onChange={(e) => { setApiKeyState(e.target.value); setKeySaved(false); }}
                placeholder={keyLoading ? "Loading..." : "Paste your API key"}
                className="h-8 text-[12px] font-mono"
                disabled={keyLoading}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-[11.5px]"
                onClick={() => void handleSaveKey()}
              >
                {keySaved ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.75} className="text-green-500" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        )}

        {currentProvider.needsHost && (
          <div className="space-y-1.5">
            <label htmlFor="ws-host" className="text-[11.5px] font-medium text-foreground">
              SearXNG host
            </label>
            <Input
              id="ws-host"
              value={host}
              onChange={(e) => void setWebSearchHost(e.target.value)}
              placeholder="http://localhost:8080"
              className="h-8 text-[12px] font-mono"
            />
            <p className="text-[10.5px] text-muted-foreground">
              URL of your self-hosted SearXNG instance.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="ws-max-results" className="text-[11.5px] font-medium text-foreground">
            Max results <span className="text-muted-foreground font-normal">({maxResults})</span>
          </label>
          <input
            id="ws-max-results"
            type="range"
            min={1}
            max={20}
            value={maxResults}
            onChange={(e) => void setWebSearchMaxResults(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10.5px] text-muted-foreground">
            <span>1</span>
            <span>20</span>
          </div>
        </div>
      </div>
    </div>
  );
}
