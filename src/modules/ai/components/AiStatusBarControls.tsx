import { Kbd } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";

export function AiOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open AI agent panel"
      className={cn(
        "flex h-5 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-[10.5px]",
        "text-muted-foreground transition-all duration-200 hover:border-border hover:bg-accent hover:text-foreground hover:scale-105",
        "animate-in slide-in-from-top-2 duration-200 ease-out active:scale-95",
      )}
      title="Open AI agent"
    >
      <span>Open AI agent</span>
      <Kbd className="h-3.5 min-w-3.5 px-0.5 text-[9px]">{fmtShortcut(MOD_KEY, "I")}</Kbd>
    </button>
  );
}
