import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "new-folder" | "new-file" | "rename" — drives title and action label. */
  mode?: "new-folder" | "new-file" | "rename";
  initialValue?: string;
};

const TITLES = {
  "new-folder": { title: "New folder", action: "Create", placeholder: "Folder name" },
  "new-file": { title: "New file", action: "Create", placeholder: "File name" },
  rename: { title: "Rename", action: "Rename", placeholder: "New name" },
} as const;

/** New folder / new file / rename prompt. Milestone 1: static, no commit. */
export function SftpNameDialog({
  open,
  onOpenChange,
  mode = "new-folder",
  initialValue = "",
}: Props) {
  const cfg = TITLES[mode];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
        </DialogHeader>
        <Input
          defaultValue={initialValue}
          placeholder={cfg.placeholder}
          className="h-8 text-sm"
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm">{cfg.action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
