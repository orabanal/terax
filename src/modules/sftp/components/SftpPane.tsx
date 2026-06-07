import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { Plug01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SftpEntry, SftpSide } from "../lib/types";
import { SftpEmptyState } from "./SftpEmptyState";
import { SftpFileRow } from "./SftpFileRow";
import { SftpToolbar } from "./SftpToolbar";

const ROW_HEIGHT = 28;
const OVERSCAN = 8;

const MARQUEE_THRESHOLD = 4;

const PARENT_ENTRY: SftpEntry = {
  name: "..",
  kind: "dir",
  size: 0,
  mtime: 0,
};

type Props = {
  side: SftpSide;
  title: string;
  path: string;
  entries: SftpEntry[];
  now: number;
  connected: boolean;
  focused: boolean;
  onFocus: () => void;
  onConnect?: () => void;
  status?: "idle" | "connecting" | "loading" | "loaded" | "error";
  error?: string | null;
  onNavigate?: (path: string) => void;
  onEnterDir?: (name: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onUp?: () => void;
  onHome?: () => void;
  onRefresh?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  showHidden?: boolean;
  onToggleHidden?: () => void;
};

export function SftpPane({
  side,
  title,
  path,
  entries,
  now,
  connected,
  focused,
  onFocus,
  onConnect,
  status = "loaded",
  error,
  onNavigate,
  onEnterDir,
  onBack,
  onForward,
  onUp,
  onHome,
  onRefresh,
  canGoBack,
  canGoForward,
  showHidden,
  onToggleHidden,
}: Props) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ top: number; height: number } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) {
      setSelected((prev) => (prev.size > 0 ? new Set() : prev));
      setAnchorIndex(null);
    }
  }, [focused]);

  const isError = status === "error";
  const isRoot = path === "/";

  const sorted = useMemo(() => {
    // On error, show only ".." so the user can navigate back.
    if (isError) return isRoot ? [] : [PARENT_ENTRY];

    const f = filter.trim().toLowerCase();
    const list = f
      ? entries.filter((e) => e.name.toLowerCase().includes(f))
      : entries;
    const sortedEntries = [...list].sort((a, b) => {
      const ad = a.kind === "dir" ? 0 : 1;
      const bd = b.kind === "dir" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });

    // Always show ".." at the top (except at root) for quick parent navigation.
    if (!isRoot) return [PARENT_ENTRY, ...sortedEntries];
    return sortedEntries;
  }, [entries, filter, isError, isRoot]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => sorted[index]?.name ?? index,
  });

  const onRowMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      const name = sorted[index]?.name;
      if (!name) return;

      if (e.button === 2) {
        setSelected((prev) => (prev.has(name) ? prev : new Set([name])));
        setAnchorIndex(index);
        return;
      }
      if (e.button !== 0) return;

      const additive = e.metaKey || e.ctrlKey;

      if (e.shiftKey && anchorIndex !== null) {
        const lo = Math.min(anchorIndex, index);
        const hi = Math.max(anchorIndex, index);
        setSelected((prev) => {
          const next = additive ? new Set(prev) : new Set<string>();
          for (let i = lo; i <= hi; i++) next.add(sorted[i].name);
          return next;
        });
        return;
      }

      if (additive) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
        setAnchorIndex(index);
        return;
      }

      setSelected(new Set([name]));
      setAnchorIndex(index);
    },
    [sorted, anchorIndex],
  );

  const onListMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[role="row"]')) return;
      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const toContentY = (clientY: number) =>
        clientY - rect.top + el.scrollTop;
      const startY = toContentY(e.clientY);
      const additive = e.metaKey || e.ctrlKey;
      const base = additive ? new Set(selected) : new Set<string>();
      let moved = false;

      const onMove = (ev: MouseEvent) => {
        const curY = toContentY(ev.clientY);
        if (!moved && Math.abs(curY - startY) < MARQUEE_THRESHOLD) return;
        moved = true;
        const lo = Math.max(0, Math.min(startY, curY));
        const hi = Math.max(startY, curY);
        setMarquee({ top: lo, height: hi - lo });
        const loIdx = Math.max(0, Math.floor(lo / ROW_HEIGHT));
        const hiIdx = Math.min(sorted.length - 1, Math.floor(hi / ROW_HEIGHT));
        const next = new Set(base);
        for (let i = loIdx; i <= hiIdx; i++) next.add(sorted[i].name);
        setSelected(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setMarquee(null);
        if (!moved && !additive) {
          setSelected(new Set());
          setAnchorIndex(null);
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [selected, sorted],
  );

  const handleRowDoubleClick = useCallback(
    (entry: SftpEntry) => {
      if (entry.name === "..") {
        onUp?.();
      } else if (entry.kind === "dir") {
        onEnterDir?.(entry.name);
      }
    },
    [onUp, onEnterDir],
  );

  const showEmpty = side === "remote" && !connected;

  const isBookmarked = bookmarks.includes(path);
  const toggleBookmark = useCallback(() => {
    setBookmarks((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, [path]);
  const removeBookmark = useCallback((p: string) => {
    setBookmarks((prev) => prev.filter((b) => b !== p));
  }, []);

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        focused && "ring-1 ring-inset ring-ring/40",
      )}
      onMouseDown={onFocus}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>

      {showEmpty ? (
        <SftpEmptyState onConnect={onConnect} status={status === "connecting" ? "connecting" : "idle"} hostName={title} />
      ) : (
        <>
          <SftpToolbar
            path={path}
            filter={filter}
            onFilterChange={setFilter}
            bookmarks={bookmarks.map((p) => ({ path: p }))}
            isBookmarked={isBookmarked}
            onToggleBookmark={toggleBookmark}
            onRemoveBookmark={removeBookmark}
            onSelectBookmark={onNavigate}
            onNavigateSegment={onNavigate}
            onBack={onBack}
            onForward={onForward}
            onUp={onUp}
            onHome={onHome}
            onRefresh={onRefresh}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            showHidden={showHidden}
            onToggleHidden={onToggleHidden}
          />

          <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-[11px] font-medium text-muted-foreground">
            <span className="min-w-0 flex-1">Name</span>
            <span className="w-20 shrink-0 text-right">Size</span>
            <span className="w-28 shrink-0 text-right">Modified</span>
            <span className="w-24 shrink-0 text-right">Permissions</span>
          </div>

          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                onMouseDown={onListMouseDown}
                className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
              >
                <div
                  style={{
                    height: virtualizer.getTotalSize(),
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {marquee && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 bg-primary/15 ring-1 ring-inset ring-primary/40"
                      style={{ top: marquee.top, height: marquee.height }}
                    />
                  )}
                  {virtualizer.getVirtualItems().map((vr) => {
                    const entry = sorted[vr.index];
                    if (!entry) return null;
                    return (
                      <div
                        key={vr.key}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: vr.size,
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <SftpFileRow
                          entry={entry}
                          selected={selected.has(entry.name)}
                          now={now}
                          onMouseDown={(e) => onRowMouseDown(vr.index, e)}
                          onDoubleClick={() => handleRowDoubleClick(entry)}
                        />
                      </div>
                    );
                  })}
                </div>

                {isError && (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                    <HugeiconsIcon
                      icon={Plug01Icon}
                      size={28}
                      strokeWidth={1.5}
                      className="text-destructive"
                    />
                    <div className="space-y-0.5 text-[11px]">
                      <div className="text-muted-foreground">
                        Error invoking remote method
                      </div>
                      <div className="text-destructive">
                        Error: {error || "Unknown error"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={onRefresh}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-44">
              <ContextMenuItem>Open</ContextMenuItem>
              <ContextMenuItem>Edit</ContextMenuItem>
              <ContextMenuItem>
                {side === "local" ? "Upload" : "Download"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>Rename</ContextMenuItem>
              <ContextMenuItem>Permissions</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <div className="flex h-6 shrink-0 items-center justify-between border-t border-border/60 px-2 text-[11px] text-muted-foreground">
            <span>{sorted.length} items</span>
            <span className="truncate">{path}</span>
          </div>
        </>
      )}
    </div>
  );
}
