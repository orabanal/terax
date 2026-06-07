import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type SubTab = {
  id: string;
  label: string;
};

type Props = {
  tabs: SubTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  canClose: boolean;
};

/** Sub-tab bar rendered inside each SFTP pane. */
export function SftpSubTabs({
  tabs,
  activeIndex,
  onSelect,
  onClose,
  canClose,
}: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border/60 bg-card px-1">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "group flex h-5 items-center gap-1 rounded px-1.5 text-[10px] transition-colors",
            i === activeIndex
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <span className="max-w-20 truncate">{tab.label}</span>
          {canClose && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              className="hidden rounded-sm hover:bg-destructive/20 hover:text-destructive group-hover:inline-flex"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
