import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCallback, useEffect, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "new-folder" | "new-file" | "rename";
  initialValue?: string;
  onSubmit?: (name: string) => void;
};

const TITLES = {
  "new-folder": { title: "New folder", action: "Create", placeholder: "Folder name" },
  "new-file": { title: "New file", action: "Create", placeholder: "File name" },
  rename: { title: "Rename", action: "Rename", placeholder: "New name" },
} as const;

export function SftpNameDialog({
  open,
  onOpenChange,
  mode = "new-folder",
  initialValue = "",
  onSubmit,
}: Props) {
  const cfg = TITLES[mode];
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit?.(trimmed);
    onOpenChange(false);
  }, [value, onSubmit, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={cfg.placeholder}
          className="h-8 text-sm"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit}>
            {cfg.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
