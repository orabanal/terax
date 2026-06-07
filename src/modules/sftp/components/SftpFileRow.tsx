import { cn } from "@/lib/utils";
import { fileIconUrl, folderIconUrl } from "@/modules/explorer/lib/iconResolver";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { formatMtime, formatPermissions, formatSize } from "../lib/format";
import type { SftpEntry } from "../lib/types";

type Props = {
  entry: SftpEntry;
  selected: boolean;
  now: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
};

function iconFor(entry: SftpEntry): string {
  if (entry.kind === "dir") return folderIconUrl(entry.name, false);
  return fileIconUrl(entry.name);
}

export const SftpFileRow = memo(function SftpFileRow({
  entry,
  selected,
  now,
  onMouseDown,
  onDoubleClick,
}: Props) {
  return (
    <div
      role="row"
      aria-selected={selected}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex h-7 w-full min-w-0 cursor-default select-none items-center gap-2 px-2 text-xs",
        selected
          ? "bg-accent text-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      <img src={iconFor(entry)} alt="" className="size-4 shrink-0" />
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
