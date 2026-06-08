import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { SftpTransferItem } from "./SftpTransferItem";
import type { SftpTransfer } from "../lib/types";

type Props = {
  transfers: SftpTransfer[];
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onClearFinished?: () => void;
  /** When true, auto-close the queue after a clean (no-failure) batch. */
  autoCloseOnComplete?: boolean;
};

/** Delay before auto-closing once everything finished cleanly, so the user
 *  catches the final "completed" state. */
const AUTO_CLOSE_MS = 1200;

export function SftpTransferQueue({
  transfers,
  onCancel,
  onRetry,
  onClearFinished,
  autoCloseOnComplete = false,
}: Props) {
  const [open, setOpen] = useState(true);
  const active = transfers.filter(
    (t) => t.status === "transferring" || t.status === "pending",
  ).length;
  const finished = transfers.filter(
    (t) =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled" ||
      t.status === "skipped",
  ).length;
  const hasFailures = transfers.some((t) => t.status === "failed");
  const hasConflicts = transfers.some((t) => t.status === "conflict");

  // Auto-collapse and clear the queue when work drains with no failures or conflicts.
  // Failed transfers always stay visible so they can be retried; conflicts stay
  // visible until the user resolves the dialog.
  const closeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (
      autoCloseOnComplete &&
      transfers.length > 0 &&
      active === 0 &&
      !hasFailures &&
      !hasConflicts
    ) {
      closeTimer.current = window.setTimeout(() => {
        onClearFinished?.();
        setOpen(true); // reset for the next batch
        closeTimer.current = null;
      }, AUTO_CLOSE_MS);
    }
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [
    autoCloseOnComplete,
    transfers.length,
    active,
    hasFailures,
    hasConflicts,
    onClearFinished,
  ]);

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
        {hasConflicts && (
          <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] tabular-nums text-destructive">
            conflict
          </span>
        )}
        {finished > 0 && onClearFinished && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClearFinished();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClearFinished();
              }
            }}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-44 divide-y divide-border/40 overflow-y-auto">
          {transfers.map((t) => (
            <SftpTransferItem
              key={t.id}
              transfer={t}
              onCancel={onCancel ? () => onCancel(t.id) : undefined}
              onRetry={onRetry ? () => onRetry(t.id) : undefined}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
