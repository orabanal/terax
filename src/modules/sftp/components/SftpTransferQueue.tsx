import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SftpTransferItem } from "./SftpTransferItem";
import type { SftpTransfer } from "../lib/types";

type Props = {
  transfers: SftpTransfer[];
};

export function SftpTransferQueue({ transfers }: Props) {
  const [open, setOpen] = useState(true);
  const active = transfers.filter(
    (t) => t.status === "transferring" || t.status === "pending",
  ).length;

  if (transfers.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="shrink-0 border-t border-border/60 bg-card"
    >
      <CollapsibleTrigger className="flex h-7 w-full items-center gap-2 px-2 text-xs font-medium text-foreground/80 hover:bg-accent/40">
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={13}
          strokeWidth={2}
          className={cn("transition-transform", !open && "-rotate-90")}
        />
        <span className="flex-1 text-left">Transfers</span>
        {active > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] tabular-nums text-primary">
            {active} active
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-44 divide-y divide-border/40 overflow-y-auto">
          {transfers.map((t) => (
            <SftpTransferItem key={t.id} transfer={t} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
