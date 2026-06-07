import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatMtime, formatSize } from "../lib/format";

type ConflictSide = {
  size: number;
  mtime: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName?: string;
  existing?: ConflictSide;
  incoming?: ConflictSide;
  now: number;
  /** Inert in Milestone 1. */
  onResolve?: (action: "overwrite" | "rename" | "skip", applyToAll: boolean) => void;
};

function Detail({ label, side, now }: { label: string; side?: ConflictSide; now: number }) {
  return (
    <div className="flex-1 rounded-md border border-border/60 p-2 text-xs">
      <div className="mb-1 font-medium text-muted-foreground">{label}</div>
      <div className="tabular-nums">{side ? formatSize(side.size) : "—"}</div>
      <div className="tabular-nums text-muted-foreground">
        {side ? formatMtime(side.mtime, now) : "—"}
      </div>
    </div>
  );
}

/** Overwrite / rename / skip resolver for an existing target. */
export function SftpConflictDialog({
  open,
  onOpenChange,
  fileName = "deploy.yml",
  existing,
  incoming,
  now,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>File already exists</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Detail label="Existing" side={existing} now={now} />
          <Detail label="Incoming" side={incoming} now={now} />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="sftp-conflict-all" />
          <Label htmlFor="sftp-conflict-all" className="text-xs text-muted-foreground">
            Apply to all conflicts
          </Label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Keep both
            </Button>
            <Button size="sm">Overwrite</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
