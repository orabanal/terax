import { cn } from "@/lib/utils";
import { fileIconUrl, folderIconUrl } from "@/modules/explorer/lib/iconResolver";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { formatMtime, formatPermissions, formatSize } from "../lib/format";
import type { SftpEntry } from "../lib/types";

type Props = {
  entry: SftpEntry;
  selected: boolean;
  now: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  editing?: boolean;
  onCommitRename?: (newName: string) => void;
  onCancelEdit?: () => void;
};

function iconFor(entry: SftpEntry): string {
  if (entry.kind === "dir") return folderIconUrl(entry.name, false);
  return fileIconUrl(entry.name);
}

function InlineEdit({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef({ onCommit, onCancel, value, initialValue });
  commitRef.current = { onCommit, onCancel, value, initialValue };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = initialValue.lastIndexOf(".");
    if (dot > 0) {
      el.setSelectionRange(0, dot);
    } else {
      el.select();
    }
  }, [initialValue]);

  // Cancel on click outside — uses document listener so it works even when
  // focus is stolen by context menus or other overlays.
  useEffect(() => {
    const handleDocMouseDown = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        const { value: v, initialValue: iv, onCommit: oc, onCancel: can } =
          commitRef.current;
        const trimmed = v.trim();
        if (trimmed && trimmed !== iv) {
          oc(trimmed);
        } else {
          can();
        }
      }
    };
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed && trimmed !== initialValue) {
          onCommit(trimmed);
        } else {
          onCancel();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [value, initialValue, onCommit, onCancel],
  );

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-5 min-w-0 flex-1 border border-ring bg-background px-1 text-xs outline-none"
    />
  );
}

export const SftpFileRow = memo(function SftpFileRow({
  entry,
  selected,
  now,
  onMouseDown,
  onDoubleClick,
  editing,
  onCommitRename,
  onCancelEdit,
}: Props) {
  return (
    <div
      role="row"
      aria-selected={selected}
      onMouseDown={editing ? undefined : onMouseDown}
      onDoubleClick={editing ? undefined : onDoubleClick}
      className={cn(
        "flex h-7 w-full min-w-0 cursor-default select-none items-center gap-2 px-2 text-xs",
        selected
          ? "bg-accent text-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      <img src={iconFor(entry)} alt="" className="size-4 shrink-0" />
      {editing ? (
        <InlineEdit
          initialValue={entry.name}
          onCommit={(name) => onCommitRename?.(name)}
          onCancel={() => onCancelEdit?.()}
        />
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
          <span className="truncate">{entry.name}</span>
          {entry.kind === "symlink" && (
            <HugeiconsIcon
              icon={Link01Icon}
              size={11}
              strokeWidth={2}
              className="shrink-0 text-muted-foreground"
            />
          )}
        </span>
      )}
      <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
        {entry.kind === "dir" ? "—" : formatSize(entry.size)}
      </span>
      <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
        {formatMtime(entry.mtime, now)}
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {entry.mode === undefined ? "—" : formatPermissions(entry.mode)}
      </span>
    </div>
  );
});
