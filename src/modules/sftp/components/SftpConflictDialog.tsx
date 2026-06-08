import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatMtime, formatSize } from "../lib/format";
import type { SftpConflictAction } from "../lib/transferConflicts";

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
  onResolve: (action: SftpConflictAction, applyToAll: boolean) => void;
};

function Detail({ label, side, now }: { label: string; side?: ConflictSide; now: number }) {
  return (
    <div className="flex-1 rounded-md border border-border/60 p-2 text-xs">
      <div className="mb-1 font-medium text-muted-foreground">{label}</div>
      <div className="tabular-nums">{side ? formatSize(side.size) : "Unknown size"}</div>
      <div className="tabular-nums text-muted-foreground">
        {side ? formatMtime(side.mtime, now) : "Unknown date"}
      </div>
    </div>
  );
}

export function SftpConflictDialog({
  open,
  onOpenChange,
  fileName = "",
  existing,
  incoming,
  now,
  onResolve,
}: Props) {
  const [applyToAll, setApplyToAll] = useState(false);

  useEffect(() => {
    if (!open) setApplyToAll(false);
  }, [open]);

  const resolve = (action: SftpConflictAction) => {
    onResolve(action, applyToAll);
    setApplyToAll(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>File already exists</DialogTitle>
          <DialogDescription className="break-words">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Detail label="Existing" side={existing} now={now} />
          <Detail label="Incoming" side={incoming} now={now} />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="sftp-conflict-all"
            checked={applyToAll}
            onCheckedChange={(checked) => setApplyToAll(checked === true)}
          />
          <Label htmlFor="sftp-conflict-all" className="text-xs text-muted-foreground">
            Apply to all conflicts in this batch
          </Label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => resolve("skip")}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => resolve("rename")}>
              Rename
            </Button>
            <Button size="sm" onClick={() => resolve("overwrite")}>
              Overwrite
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
