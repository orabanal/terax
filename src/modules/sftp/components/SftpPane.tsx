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
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SFTP_SORT,
  nextSftpSort,
  sortSftpEntries,
  type SftpSortColumn,
  type SftpSortState,
} from "@/modules/sftp/lib/sortEntries";
import type { DirMutations, SftpEntry, SftpPaneSide, SftpSide } from "../lib/types";
import type { SshHost } from "@/modules/ssh/store";
import { SftpDragContext } from "../lib/SftpDragContext";
import { useSftpBookmarks } from "../lib/useSftpBookmarks";
import { SftpDeleteDialog } from "./SftpDeleteDialog";
import { SftpEmptyState } from "./SftpEmptyState";
import { SftpFileRow } from "./SftpFileRow";
import { SftpHostPicker } from "./SftpHostPicker";
import { SftpPermissionsDialog } from "./SftpPermissionsDialog";
import { SftpToolbar } from "./SftpToolbar";

const ROW_HEIGHT = 28;
const OVERSCAN = 8;
const MARQUEE_THRESHOLD = 4;
/** Pixels the cursor must travel before a row press becomes a drag. */
const DRAG_THRESHOLD = 4;

const PARENT_ENTRY: SftpEntry = {
  name: "..",
  kind: "dir",
  size: 0,
  mtime: 0,
};

export type SftpPaneMode = "local" | "remote";

/** Phantom entry injected at the top of the list during inline creation. */
const PHANTOM_ENTRY: SftpEntry = {
  name: "",
  kind: "file",
  size: 0,
  mtime: 0,
};

type InlineEditState =
  | null
  | { kind: "new-folder" }
  | { kind: "new-file" }
  | { kind: "rename"; originalName: string };

type ModalDialogState =
  | { kind: "none" }
  | { kind: "delete"; entries: SftpEntry[] }
  | { kind: "permissions"; entry: SftpEntry };

type Props = {
  /** Unique key for scoping bookmarks to this connection. */
  connKey: string;
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
  mode?: SftpPaneMode;
  /** SFTP session ID for remote file operations. */
  sessionId?: number | null;
  /** Opens a remote file in the local editor. */
  editRemoteFile?: (sessionId: number, remotePath: string) => Promise<void>;
  /** Opens a remote file with the OS default application. */
  openRemoteFile?: (sessionId: number, remotePath: string) => Promise<void>;
  hosts?: SshHost[];
  onHostSelect?: (host: SshHost) => void;
  onLocal?: () => void;
} & DirMutations;

type SortHeaderProps = {
  column: SftpSortColumn;
  label: string;
  sort: SftpSortState;
  className?: string;
  align?: "left" | "right";
  onSort: (column: SftpSortColumn) => void;
};

function SortHeader({
  column,
  label,
  sort,
  className,
  align = "left",
  onSort,
}: SortHeaderProps) {
  const active = sort.column === column;
  const ariaSort = active
    ? sort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <div role="columnheader" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "flex h-full w-full items-center gap-1 rounded-sm text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          align === "right" && "justify-end text-right",
        )}
      >
        <span className="truncate">{label}</span>
        <span className="w-2 text-[10px] text-muted-foreground">
          {active ? (sort.direction === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </div>
  );
}

export function SftpPane({
  connKey,
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
  mode,
  sessionId,
  editRemoteFile,
  openRemoteFile,
  hosts,
  onHostSelect,
  onLocal,
  mkdir,
  createFile,
  rename,
  remove,
  chmod,
}: Props) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);
  const [modal, setModal] = useState<ModalDialogState>({ kind: "none" });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [sort, setSort] = useState<SftpSortState>(DEFAULT_SFTP_SORT);
  const scrollRef = useRef<HTMLDivElement>(null);

  const drag = useContext(SftpDragContext);

  const effectiveMode: SftpPaneMode = mode ?? (side === "local" ? "local" : "remote");

  // Top-level side ("left" | "right") inferred from the pane's DOM ancestor so
  // the drag layer can tell the two halves apart. connKey already disambiguates
  // sub-tabs, so we derive paneSide lazily at drag-start instead of threading a
  // prop through SftpConnection.
  const paneRootRef = useRef<HTMLDivElement>(null);
  const resolvePaneSide = useCallback((): SftpPaneSide => {
    const el = paneRootRef.current?.closest<HTMLElement>("[data-sftp-side]");
    return (el?.getAttribute("data-sftp-side") as SftpPaneSide) ?? "left";
  }, []);

  const makePaneRef = useCallback(
    () => ({
      side: resolvePaneSide(),
      connKey,
      mode: effectiveMode,
      path,
      sessionId: sessionId ?? null,
    }),
    [resolvePaneSide, connKey, effectiveMode, path, sessionId],
  );

  // Keep the drag layer's pane registry in sync so drops can hit-test this
  // pane and resolve its current path/session at drop time.
  useEffect(() => {
    if (!drag) return;
    drag.registerPane(makePaneRef());
    return () => drag.unregisterPane(connKey);
  }, [drag, makePaneRef, connKey]);

  const { bookmarks, toggle: toggleBookmark, remove: removeBookmark, isBookmarked } =
    useSftpBookmarks(connKey);

  useEffect(() => {
    if (!focused) {
      setSelected((prev) => (prev.size > 0 ? new Set() : prev));
      setAnchorIndex(null);
    }
  }, [focused]);

  const isError = status === "error";
  const isRoot = path === "/";

  const sorted = useMemo(() => {
    if (isError) return isRoot ? [] : [PARENT_ENTRY];

    const f = filter.trim().toLowerCase();
    const list = f
      ? entries.filter((e) => e.name.toLowerCase().includes(f))
      : entries;
    const sortedEntries = sortSftpEntries(list, sort);

    const result = isRoot ? sortedEntries : [PARENT_ENTRY, ...sortedEntries];

    // Inject phantom entry for inline creation at the top (after "..").
    if (inlineEdit?.kind === "new-folder" || inlineEdit?.kind === "new-file") {
      const phantom = {
        ...PHANTOM_ENTRY,
        kind: inlineEdit.kind === "new-folder" ? ("dir" as const) : ("file" as const),
      };
      return isRoot
        ? [phantom, ...result]
        : [PARENT_ENTRY, phantom, ...result.slice(1)];
    }

    return result;
  }, [entries, filter, isError, isRoot, inlineEdit, sort]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => sorted[index]?.name ?? `phantom-${index}`,
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
      const shift = e.shiftKey;

      // Applies the click/shift/cmd selection. Deferred until mouseup so a drag
      // gesture (press + move) doesn't collapse a multi-selection first.
      const applySelection = () => {
        if (shift && anchorIndex !== null) {
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
      };

      // ".." is never draggable, and a plain re-press on an already-selected
      // row keeps the multi-selection so it can be dragged as a group.
      const isParent = name === "..";
      const onSelectedRow = selected.has(name);
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMove = (ev: MouseEvent) => {
        if (dragging || isParent || !drag) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) {
          return;
        }
        dragging = true;

        // Drag the current selection if the press landed on a selected row;
        // otherwise drag just this row (and make it the selection).
        let names: Set<string>;
        if (onSelectedRow && !additive && !shift) {
          names = selected;
        } else {
          names = new Set([name]);
          setSelected(names);
          setAnchorIndex(index);
        }
        const dragged = sorted.filter(
          (en) => en.name !== ".." && en.name !== "" && names.has(en.name),
        );
        if (dragged.length === 0) return;
        drag.startDrag({ source: makePaneRef(), entries: dragged }, ev.clientX, ev.clientY);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!dragging) applySelection();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sorted, anchorIndex, selected, drag, makePaneRef],
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

  const isTextByExt = useCallback((name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const textExts = new Set([
      "txt", "md", "json", "xml", "yaml", "yml", "toml", "js", "ts", "jsx",
      "tsx", "py", "rb", "php", "sh", "c", "h", "cpp", "rs", "go", "java",
      "css", "scss", "html", "htm", "svg", "sql", "env", "conf", "ini",
      "log", "csv", "lua", "vim", "swift", "dart", "ex", "hs", "proto",
      "tf", "lock", "sum", "r", "R", "kt", "m", "mm",
    ]);
    return textExts.has(ext) || !ext;
  }, []);

  const handleRowDoubleClick = useCallback(
    (entry: SftpEntry) => {
      if (entry.name === "..") {
        onUp?.();
      } else if (entry.kind === "dir") {
        onEnterDir?.(entry.name);
      } else if (effectiveMode === "local") {
        void invoke("fs_open", { path: `${path}/${entry.name}` }).catch(() => {});
      } else if (sessionId != null) {
        const fullPath = `${path}/${entry.name}`;
        setRemoteLoading(true);
        const handler = isTextByExt(entry.name) ? editRemoteFile : openRemoteFile;
        void handler?.(sessionId, fullPath).finally(() =>
          setRemoteLoading(false),
        );
      }
    },
    [onUp, onEnterDir, effectiveMode, path, sessionId, editRemoteFile, openRemoteFile, isTextByExt],
  );

  const showEmpty = effectiveMode === "remote" && !connected;

  const selectedEntries = useMemo(
    () => sorted.filter((e) => e.name !== ".." && e.name !== "" && selected.has(e.name)),
    [sorted, selected],
  );

  // Inline edit commit handlers.
  const commitNewFolder = useCallback(
    (name: string) => {
      setInlineEdit(null);
      void mkdir(name);
    },
    [mkdir],
  );

  const commitNewFile = useCallback(
    (name: string) => {
      setInlineEdit(null);
      void createFile(name);
    },
    [createFile],
  );

  const commitRename = useCallback(
    (newName: string) => {
      const original = inlineEdit?.kind === "rename" ? inlineEdit.originalName : null;
      setInlineEdit(null);
      if (original && original !== newName) void rename(original, newName);
    },
    [inlineEdit, rename],
  );

  const cancelEdit = useCallback(() => setInlineEdit(null), []);

  // Delete handler.
  const handleDelete = useCallback(() => {
    const toDelete = selectedEntries.filter((e) => e.name !== "..");
    if (toDelete.length > 0) void remove(toDelete);
  }, [remove, selectedEntries]);

  // Chmod handler.
  const handleChmod = useCallback(
    (newMode: number) => {
      const entry = selectedEntries[0];
      if (entry) void chmod(entry.name, newMode);
    },
    [chmod, selectedEntries],
  );

  // Open handler — text files open in editor, non-text open with OS app.
  const handleOpen = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry) return;
    if (entry.kind === "dir") {
      onEnterDir?.(entry.name);
    } else if (effectiveMode === "local") {
      void invoke("fs_open", { path: `${path}/${entry.name}` }).catch(() => {});
    } else if (sessionId != null) {
      const fullPath = `${path}/${entry.name}`;
      setRemoteLoading(true);
      const handler = isTextByExt(entry.name) ? editRemoteFile : openRemoteFile;
      void handler?.(sessionId, fullPath).finally(() =>
        setRemoteLoading(false),
      );
    }
  }, [selectedEntries, onEnterDir, effectiveMode, path, sessionId, editRemoteFile, openRemoteFile, isTextByExt]);

  // Open with OS default app (always, even for text files).
  const handleOpenWith = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry || entry.kind === "dir") return;
    if (effectiveMode === "local") {
      void invoke("fs_open", { path: `${path}/${entry.name}` }).catch(() => {});
    } else if (sessionId != null && openRemoteFile) {
      setRemoteLoading(true);
      void openRemoteFile(sessionId, `${path}/${entry.name}`).finally(() =>
        setRemoteLoading(false),
      );
    }
  }, [selectedEntries, effectiveMode, path, sessionId, openRemoteFile]);

  // Reveal in Finder / file manager.
  const handleReveal = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry || effectiveMode !== "local") return;
    void invoke("fs_reveal", { path: `${path}/${entry.name}` }).catch(() => {});
  }, [selectedEntries, effectiveMode, path]);

  return (
    <div
      ref={paneRootRef}
      data-sftp-pane
      data-conn-key={connKey}
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        focused && "ring-1 ring-inset ring-ring/40",
        drag?.drag?.hovered?.pane.connKey === connKey &&
          "ring-1 ring-inset ring-primary",
      )}
      onMouseDown={onFocus}
    >
      {hosts && onHostSelect && onLocal && (
        <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-2">
          <div className="flex-1" />
          <SftpHostPicker hosts={hosts} onSelect={onHostSelect} onLocal={onLocal} />
        </div>
      )}

      {showEmpty ? (
        <SftpEmptyState onConnect={onConnect} status={status === "connecting" ? "connecting" : "idle"} hostName={title} />
      ) : (
        <>
          <SftpToolbar
            path={path}
            filter={filter}
            onFilterChange={setFilter}
            bookmarks={bookmarks.map((p) => ({ path: p }))}
            isBookmarked={isBookmarked(path)}
            onToggleBookmark={() => toggleBookmark(path)}
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
            onNewFolder={() => setInlineEdit({ kind: "new-folder" })}
            onNewFile={() => setInlineEdit({ kind: "new-file" })}
          />

          <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-[11px] font-medium text-muted-foreground">
            <SortHeader
              column="name"
              label="Name"
              sort={sort}
              onSort={(column) => setSort((current) => nextSftpSort(current, column))}
              className="min-w-0 flex-1"
            />
            <SortHeader
              column="size"
              label="Size"
              sort={sort}
              onSort={(column) => setSort((current) => nextSftpSort(current, column))}
              className="w-20 shrink-0"
              align="right"
            />
            <SortHeader
              column="mtime"
              label="Modified"
              sort={sort}
              onSort={(column) => setSort((current) => nextSftpSort(current, column))}
              className="w-28 shrink-0"
              align="right"
            />
            <SortHeader
              column="permissions"
              label="Permissions"
              sort={sort}
              onSort={(column) => setSort((current) => nextSftpSort(current, column))}
              className="w-24 shrink-0"
              align="right"
            />
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
                    const isPhantom = entry.name === "";
                    const isRenaming =
                      inlineEdit?.kind === "rename" &&
                      inlineEdit.originalName === entry.name;
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
                          editing={isPhantom || isRenaming}
                          onCommitRename={
                            isPhantom
                              ? inlineEdit?.kind === "new-folder"
                                ? commitNewFolder
                                : commitNewFile
                              : isRenaming
                                ? commitRename
                                : undefined
                          }
                          onCancelEdit={cancelEdit}
                        />
                      </div>
                    );
                  })}
                </div>

                {remoteLoading && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
                    <div className="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm ring-1 ring-border/60">
                      <div className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      Downloading...
                    </div>
                  </div>
                )}

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
              <ContextMenuItem
                disabled={selectedEntries.length !== 1}
                onClick={handleOpen}
              >
                Open
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedEntries.length !== 1 || selectedEntries[0]?.kind === "dir"}
                onClick={handleOpenWith}
              >
                Open with...
              </ContextMenuItem>
              <ContextMenuItem
                disabled={
                  selectedEntries.length !== 1 ||
                  selectedEntries[0]?.kind === "dir" ||
                  (effectiveMode === "remote" && sessionId == null)
                }
                onClick={handleOpen}
              >
                Edit
              </ContextMenuItem>
              <ContextMenuItem disabled>
                {effectiveMode === "local" ? "Upload" : "Download"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setInlineEdit({ kind: "new-folder" })}>
                New folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setInlineEdit({ kind: "new-file" })}>
                New file
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedEntries.length !== 1}
                onClick={() => {
                  const entry = selectedEntries[0];
                  if (entry) setInlineEdit({ kind: "rename", originalName: entry.name });
                }}
              >
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedEntries.length !== 1 || selectedEntries[0]?.mode == null}
                onClick={() => {
                  const entry = selectedEntries[0];
                  if (entry) setModal({ kind: "permissions", entry });
                }}
              >
                Permissions
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={selectedEntries.length !== 1 || effectiveMode !== "local"}
                onClick={handleReveal}
              >
                Reveal in Finder
              </ContextMenuItem>
              <ContextMenuItem onClick={onRefresh}>
                Refresh
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={selectedEntries.length === 0}
                onClick={() => setModal({ kind: "delete", entries: selectedEntries })}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <div className="flex h-6 shrink-0 items-center justify-between border-t border-border/60 px-2 text-[11px] text-muted-foreground">
            <span>{sorted.length} items</span>
            <span className="truncate">{path}</span>
          </div>
        </>
      )}

      {/* Modal dialogs (delete + permissions only) */}
      <SftpDeleteDialog
        open={modal.kind === "delete"}
        onOpenChange={(o) => !o && setModal({ kind: "none" })}
        names={modal.kind === "delete" ? modal.entries.map((e) => e.name) : []}
        onConfirm={handleDelete}
      />
      <SftpPermissionsDialog
        open={modal.kind === "permissions"}
        onOpenChange={(o) => !o && setModal({ kind: "none" })}
        fileName={modal.kind === "permissions" ? modal.entry.name : undefined}
        mode={modal.kind === "permissions" ? (modal.entry.mode ?? 0o644) : 0o644}
        onApply={handleChmod}
      />
    </div>
  );
}
