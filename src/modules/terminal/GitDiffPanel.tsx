import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  GitBranchIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { ParsedGitDiff } from "./lib/gitDiffParser";

export type GitDiffPanelProps = {
  open: boolean;
  onClose: () => void;
  data: ParsedGitDiff | null;
  loading: boolean;
  branch: string | null;
  onRefresh: () => void;
};

export function GitDiffPanel({ open, onClose, data, loading, branch, onRefresh }: GitDiffPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [height, setHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; h: number } | null>(null);

  const handleDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    dragStart.current = { y: e.clientY, h: panel.offsetHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current || !panel) return;
      const delta = dragStart.current.y - ev.clientY;
      const next = dragStart.current.h + delta;
      const parentH = (panel.offsetParent as HTMLElement | null)?.clientHeight ?? 400;
      setHeight(Math.max(80, Math.min(next, Math.round(parentH * 0.9))));
    };

    const onUp = () => {
      dragStart.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (data) {
      const initial: Record<string, boolean> = {};
      for (const f of data.files) initial[f.path] = true;
      setExpanded(initial);
    }
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute bottom-0 left-0 right-0 z-30 flex flex-col bg-card border-t border-border/60 overflow-hidden"
      style={{ height: height !== null ? `${height}px` : "50%" }}
    >
      <div
        onMouseDown={handleDragMouseDown}
        className="group absolute left-0 right-0 top-0 z-10 h-1.5 cursor-ns-resize select-none"
      >
        <div className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 rounded-full bg-border/0 transition-colors group-hover:bg-border/80" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 shrink-0">
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={13}
          strokeWidth={1.75}
          className="text-muted-foreground shrink-0"
        />
        <span className="text-[12px] font-medium truncate">{branch ?? ""}</span>
        {data && (
          <span className="text-[11px] text-muted-foreground ml-1 shrink-0">
            {data.files.length} {data.files.length === 1 ? "file" : "files"}
            {data.totalAdded > 0 && (
              <span className="text-emerald-500 ml-1">+{data.totalAdded}</span>
            )}
            {data.totalRemoved > 0 && (
              <span className="text-red-500 ml-1">-{data.totalRemoved}</span>
            )}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            Loading...
          </div>
        )}
        {!loading && data && data.files.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            No changes
          </div>
        )}
        {!loading && data && data.files.map((file) => {
          const isExpanded = expanded[file.path] ?? true;
          return (
            <div key={file.path} className="border-b border-border/40 last:border-0">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [file.path]: !isExpanded }))
                }
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
              >
                <HugeiconsIcon
                  icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                  size={11}
                  strokeWidth={2}
                  className="text-muted-foreground shrink-0"
                />
                <span className="flex-1 truncate text-[11.5px] font-medium">{file.path}</span>
                {file.isBinary ? (
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">binary</span>
                ) : (
                  <span className="shrink-0 text-[10.5px]">
                    {file.added > 0 && (
                      <span className="text-emerald-500">+{file.added}</span>
                    )}
                    {file.added > 0 && file.removed > 0 && (
                      <span className="mx-0.5 text-muted-foreground">/</span>
                    )}
                    {file.removed > 0 && (
                      <span className="text-red-500">-{file.removed}</span>
                    )}
                  </span>
                )}
              </button>

              {isExpanded && !file.isBinary && (
                <div className="overflow-x-auto">
                  {file.hunks.map((hunk, hi) => (
                    <div key={hi}>
                      <div className="bg-muted/20 px-3 py-0.5 font-mono text-[10.5px] text-muted-foreground/60">
                        {hunk.header}
                      </div>
                      {hunk.lines.map((line, li) => (
                        <div
                          key={li}
                          className={cn(
                            "whitespace-pre px-3 py-px font-mono text-[11px] leading-relaxed",
                            line.type === "add" &&
                              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            line.type === "remove" &&
                              "bg-red-500/10 text-red-600 dark:text-red-400",
                            line.type === "context" && "text-foreground/70",
                          )}
                        >
                          <span className="mr-1 select-none opacity-50">
                            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                          </span>
                          {line.content}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {isExpanded && file.isBinary && (
                <div className="px-3 py-2 text-[11px] italic text-muted-foreground">
                  Binary file
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
