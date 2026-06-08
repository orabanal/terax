import { Folder01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSftpDrag } from "../lib/SftpDragContext";

const GHOST_Z = 2147483646;

/** Cursor-following drag preview. Mounted once at the SFTP view root. */
export function SftpDragGhost() {
  const { drag } = useSftpDrag();
  if (!drag || typeof document === "undefined") return null;

  const { payload, x, y, hovered, invalid } = drag;
  const count = payload.entries.length;
  const single = count === 1 ? payload.entries[0] : null;
  const label = single ? single.name : `${count} items`;
  const icon = single && single.kind === "dir" ? Folder01Icon : File01Icon;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0"
      style={{
        zIndex: GHOST_Z,
        transform: `translate(${x + 12}px, ${y + 8}px)`,
      }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs shadow-lg ring-1",
          invalid
            ? "bg-destructive/90 text-destructive-foreground ring-destructive"
            : hovered
              ? "bg-primary text-primary-foreground ring-primary"
              : "bg-card text-foreground/80 ring-border/60",
        )}
      >
        <HugeiconsIcon icon={icon} size={13} strokeWidth={2} />
        <span className="max-w-48 truncate">{label}</span>
        {hovered && !invalid && (
          <span className="opacity-80">→ {basename(hovered.intoDir)}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
