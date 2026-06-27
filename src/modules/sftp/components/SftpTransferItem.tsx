import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatSize } from "../lib/format";
import type { SftpTransfer } from "../lib/types";

type Props = {
  transfer: SftpTransfer;
  onCancel?: () => void;
  onRetry?: () => void;
};

const STATUS_LABEL: Record<SftpTransfer["status"], string> = {
  pending: "Queued",
  transferring: "",
  conflict: "Conflict",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export function SftpTransferItem({ transfer, onCancel, onRetry }: Props) {
  const pct =
    transfer.totalBytes > 0
      ? Math.min(100, (transfer.transferredBytes / transfer.totalBytes) * 100)
      : 0;
  const active = transfer.status === "transferring" || transfer.status === "pending";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/40">
      <HugeiconsIcon
        icon={transfer.direction === "upload" ? ArrowUp01Icon : ArrowDown01Icon}
        size={13}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{transfer.fileName}</span>
          <span
            className="shrink-0 tabular-nums text-muted-foreground"
            title={transfer.status === "failed" ? transfer.errorMessage : undefined}
          >
            {active
              ? `${formatSize(transfer.transferredBytes)} / ${formatSize(transfer.totalBytes)}`
              : STATUS_LABEL[transfer.status]}
          </span>
        </div>
        {active && (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="h-1 flex-1" />
            <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
              {transfer.speed > 0 ? `${formatSize(transfer.speed)}/s` : ""}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {transfer.status === "failed" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            onClick={onRetry}
            title="Retry"
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-5 text-muted-foreground hover:text-foreground",
            !active && transfer.status !== "failed" && "opacity-60",
          )}
          onClick={onCancel}
          title={active ? "Cancel" : "Dismiss"}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
