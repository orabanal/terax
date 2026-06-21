import { detectMonoFontFamily } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef } from "react";

type Props = {
  onSend: (text: string) => void;
  onClose: () => void;
};

function autoSize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

export function ComposeBar({ onSend, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  const fontFamilyPref = usePreferencesStore((p) => p.terminalFontFamily);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const fontFamily = fontFamilyPref || detectMonoFontFamily();

  useEffect(() => {
    const timer = setTimeout(() => taRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSend = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const text = el.value;
    if (!text) return;
    onSend(text);
    el.value = "";
    el.style.height = "auto";
    el.focus();
  }, [onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
        e.preventDefault();
        handleSend();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [handleSend, onClose],
  );

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-card px-3 py-2 shadow-[0_-4px_12px_rgba(0,0,0,0.12)]">
      <textarea
        ref={taRef}
        rows={1}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="Type command here, press Enter to send..."
        onInput={(e) => autoSize(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={() => {
          isComposing.current = false;
        }}
        className={cn(
          "min-h-[20px] max-h-[120px] flex-1 resize-none bg-transparent",
          "text-foreground outline-none placeholder:text-muted-foreground/40",
        )}
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5 }}
      />
      <button
        type="button"
        onClick={onClose}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
