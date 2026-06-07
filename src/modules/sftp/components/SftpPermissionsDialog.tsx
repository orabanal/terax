import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatOctal } from "../lib/format";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Target name shown in the title. */
  fileName?: string;
  /** Current mode bits (defaults to 0o644 for the static shell). */
  mode?: number;
};

const ROLES = [
  { key: "owner", label: "Owner", shift: 6 },
  { key: "group", label: "Group", shift: 3 },
  { key: "other", label: "Other", shift: 0 },
] as const;

const PERMS = [
  { key: "r", label: "Read", bit: 4 },
  { key: "w", label: "Write", bit: 2 },
  { key: "x", label: "Execute", bit: 1 },
] as const;

/** chmod editor. Milestone 1: renders the matrix from a static mode, no apply. */
export function SftpPermissionsDialog({
  open,
  onOpenChange,
  fileName = "file.txt",
  mode = 0o644,
}: Props) {
  const has = (shift: number, bit: number) => ((mode >> shift) & bit) === bit;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Permissions</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-[5rem_repeat(3,1fr)] items-center gap-2 text-xs text-muted-foreground">
            <span />
            {PERMS.map((p) => (
              <span key={p.key} className="text-center">
                {p.label}
              </span>
            ))}
          </div>
          {ROLES.map((role) => (
            <div
              key={role.key}
              className="grid grid-cols-[5rem_repeat(3,1fr)] items-center gap-2"
            >
              <span className="text-xs font-medium">{role.label}</span>
              {PERMS.map((p) => (
                <div key={p.key} className="flex justify-center">
                  <Checkbox checked={has(role.shift, p.bit)} />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Octal</span>
          <span className="font-mono tabular-nums">{formatOctal(mode)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm">Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
