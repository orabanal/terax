import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  CpuIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { MODELS, resolveModel } from "../config";

type Props = {
  selectedModelId: string;
  onSelect: (id: string) => void;
};

export const AiModelPicker = memo(function AiModelPicker({
  selectedModelId,
  onSelect,
}: Props) {
  const current = resolveModel(selectedModelId);

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
        {MODELS.map((m) => (
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
