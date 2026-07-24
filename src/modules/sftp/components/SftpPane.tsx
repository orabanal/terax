import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { ArrowDown01Icon, ArrowRight01Icon, Plug01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fileIconUrl, folderIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  DEFAULT_SFTP_SORT,
  nextSftpSort,
  sortSftpEntries,
  type SftpSortColumn,
  type SftpSortState,
} from "@/modules/sftp/lib/sortEntries";
import type { ColWidths, DirMutations, SftpEntry, SftpPaneSide, SftpSide, SftpViewMode } from "../lib/types";
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
const DEFAULT_COL_WIDTHS: ColWidths = { size: 80, mtime: 112, permissions: 96 };
const MIN_COL_WIDTH = 48;
/** Pixels the cursor must travel before a row press becomes a drag. */
const DRAG_THRESHOLD = 4;

const PARENT_ENTRY: SftpEntry = {
  name: "..",
  kind: "dir",
  size: 0,
  mtime: 0,
};

function describeError(e: unknown): string {
  return typeof e === "string" ? e : String(e);
}

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
  /** Downloads a remote file to temp and opens the native "open with" app picker. */
  openRemoteFileWith?: (sessionId: number, remotePath: string) => Promise<void>;
  /** Opens a local path as a Terax editor tab. */
  onOpenFile?: (path: string) => void;
  hosts?: SshHost[];
  onHostSelect?: (host: SshHost) => void;
  onLocal?: () => void;
  onDuplicate?: (pane: import("../lib/types").SftpPaneRef, entries: SftpEntry[]) => void;
} & DirMutations;

type TreeNode = {
  entry: SftpEntry;
  depth: number;
  fullPath: string;
};

function treeIconFor(entry: SftpEntry): string {
  if (entry.kind === "dir") return folderIconUrl(entry.name, false);
  return fileIconUrl(entry.name);
}

const COL_VAR: Record<keyof ColWidths, string> = {
  size: "--sftp-col-size",
  mtime: "--sftp-col-mtime",
  permissions: "--sftp-col-permissions",
};

type ResizeHandleProps = {
  col: keyof ColWidths;
  startWidth: number;
  containerRef: React.RefObject<HTMLElement | null>;
  onResize: (col: keyof ColWidths, w: number) => void;
};

function ResizeHandle({ col, startWidth, containerRef, onResize }: ResizeHandleProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const varName = COL_VAR[col];

      const clamp = (x: number) => Math.max(MIN_COL_WIDTH, x);

      const onMove = (ev: MouseEvent) => {
        const w = clamp(startWidth + (startX - ev.clientX));
        // Direct DOM update — no React re-render during drag
        containerRef.current?.style.setProperty(varName, `${w}px`);
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const w = clamp(startWidth + (startX - ev.clientX));
        containerRef.current?.style.setProperty(varName, `${w}px`);
        onResize(col, w);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [col, startWidth, containerRef, onResize],
  );

  return (
    <div
      className="group absolute inset-y-0 -left-[5px] z-10 flex w-[10px] cursor-col-resize items-center justify-center"
      onMouseDown={onMouseDown}
    >
      <div className="h-full w-px bg-border/60 transition-colors group-hover:bg-primary/70 group-active:bg-primary" />
    </div>
  );
}

type TreeRowProps = {
  node: TreeNode;
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggle: (e: React.MouseEvent) => void;
};

function TreeRow({ node, selected, expanded, loading, onMouseDown, onDoubleClick, onToggle }: TreeRowProps) {
  const isDir = node.entry.kind === "dir";
  return (
    <div
      role="row"
      data-row-name={node.entry.name}
      data-row-kind={node.entry.kind}
      aria-selected={selected}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      className={cn(
        "flex h-7 w-full cursor-default select-none items-center gap-1.5 pr-2 text-xs",
        selected ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isDir && (
          loading ? (
            <div className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <HugeiconsIcon
              icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
              size={10}
              strokeWidth={2.5}
            />
          )
        )}
      </button>
      <img src={treeIconFor(node.entry)} alt="" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{node.entry.name}</span>
    </div>
  );
}

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
  openRemoteFileWith,
  onOpenFile,
  hosts,
  onHostSelect,
  onLocal,
  onDuplicate,
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
  const [iconMarquee, setIconMarquee] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);
  const [modal, setModal] = useState<ModalDialogState>({ kind: "none" });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [sort, setSort] = useState<SftpSortState>(DEFAULT_SFTP_SORT);
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const [viewMode, setViewMode] = useState<SftpViewMode>("list");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleResize = useCallback(
    (col: keyof ColWidths, w: number) => setColWidths((prev) => ({ ...prev, [col]: w })),
    [],
  );

  // Keep CSS custom properties in sync with state (before paint to avoid flash).
  // During a drag, the ResizeHandle updates these variables directly on the DOM
  // without going through React, so no re-renders happen while dragging.
  useLayoutEffect(() => {
    const el = paneRootRef.current;
    if (!el) return;
    el.style.setProperty(COL_VAR.size, `${colWidths.size}px`);
    el.style.setProperty(COL_VAR.mtime, `${colWidths.mtime}px`);
    el.style.setProperty(COL_VAR.permissions, `${colWidths.permissions}px`);
  }, [colWidths]);

  // Tree view state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, SftpEntry[]>>(new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

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

  // Reset tree expansion when navigating to a different directory
  useEffect(() => {
    setExpandedPaths(new Set());
    setDirContents(new Map());
    setLoadingPaths(new Set());
  }, [path]);

  // Invalidate cached subtree contents when hidden-file preference changes
  useEffect(() => {
    setDirContents(new Map());
  }, [showHidden]);

  const loadDirContents = useCallback(
    async (dirPath: string) => {
      if (loadingPaths.has(dirPath)) return;
      setLoadingPaths((prev) => new Set([...prev, dirPath]));
      try {
        let loaded: SftpEntry[];
        if (effectiveMode === "local") {
          loaded = await invoke<SftpEntry[]>("fs_read_dir", {
            path: dirPath,
            showHidden: showHidden ?? false,
          });
        } else if (sessionId != null) {
          loaded = await invoke<SftpEntry[]>("sftp_list_dir", {
            sessionId,
            path: dirPath,
          });
        } else {
          return;
        }
        setDirContents((prev) => new Map(prev).set(dirPath, loaded));
      } catch {
        // directory unreadable — leave it collapsed
      } finally {
        setLoadingPaths((prev) => {
          const s = new Set(prev);
          s.delete(dirPath);
          return s;
        });
      }
    },
    [loadingPaths, effectiveMode, showHidden, sessionId],
  );

  const toggleExpand = useCallback(
    (fullPath: string, entry: SftpEntry) => {
      if (entry.kind !== "dir") return;
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(fullPath)) {
          next.delete(fullPath);
          return next;
        }
        next.add(fullPath);
        return next;
      });
      if (!dirContents.has(fullPath)) {
        void loadDirContents(fullPath);
      }
    },
    [dirContents, loadDirContents],
  );

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

  const treeNodes = useMemo((): TreeNode[] => {
    if (viewMode !== "tree" || isError) return [];

    const buildNodes = (nodeEntries: SftpEntry[], basePath: string, depth: number): TreeNode[] => {
      const f = filter.trim().toLowerCase();
      const filtered = nodeEntries.filter(
        (e) => e.name !== ".." && (!f || e.name.toLowerCase().includes(f)),
      );
      const result: TreeNode[] = [];
      for (const entry of sortSftpEntries(filtered, sort)) {
        const fullPath = basePath === "/" ? `/${entry.name}` : `${basePath}/${entry.name}`;
        result.push({ entry, depth, fullPath });
        if (entry.kind === "dir" && expandedPaths.has(fullPath)) {
          const children = dirContents.get(fullPath);
          if (children) result.push(...buildNodes(children, fullPath, depth + 1));
        }
      }
      return result;
    };

    return buildNodes(entries, path, 0);
  }, [viewMode, isError, entries, path, filter, sort, expandedPaths, dirContents]);

  // Active items: treeNodes in tree mode, sorted in list/icons modes
  const activeList = viewMode === "tree" ? treeNodes : sorted;

  const virtualizer = useVirtualizer({
    count: activeList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => {
      if (viewMode === "tree") {
        const node = treeNodes[index];
        return node ? `tree:${node.fullPath}` : `tree-phantom-${index}`;
      }
      return sorted[index]?.name ?? `phantom-${index}`;
    },
  });

  const onRowMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      const name = viewMode === "tree" ? treeNodes[index]?.entry.name : sorted[index]?.name;
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
            for (let i = lo; i <= hi; i++) {
              const n = viewMode === "tree" ? treeNodes[i]?.entry.name : sorted[i]?.name;
              if (n) next.add(n);
            }
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
        const sourceList = viewMode === "tree"
          ? treeNodes.map((n) => n.entry)
          : sorted;
        const dragged = sourceList.filter(
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
    [sorted, treeNodes, viewMode, anchorIndex, selected, drag, makePaneRef],
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

  // Icon mode has no fixed row height or single column, so unlike
  // onListMouseDown (which derives row indices from a Y offset), this hit-tests
  // real cell rects against the drag box on every move.
  const onIconMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-row-name]")) return;
      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const toContent = (clientX: number, clientY: number) => ({
        x: clientX - rect.left + el.scrollLeft,
        y: clientY - rect.top + el.scrollTop,
      });
      const start = toContent(e.clientX, e.clientY);
      const additive = e.metaKey || e.ctrlKey;
      const base = additive ? new Set(selected) : new Set<string>();
      let moved = false;

      const onMove = (ev: MouseEvent) => {
        const cur = toContent(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(cur.x - start.x, cur.y - start.y) < MARQUEE_THRESHOLD) {
          return;
        }
        moved = true;
        const left = Math.min(start.x, cur.x);
        const top = Math.min(start.y, cur.y);
        const width = Math.abs(cur.x - start.x);
        const height = Math.abs(cur.y - start.y);
        setIconMarquee({ left, top, width, height });

        const boxRight = left + width;
        const boxBottom = top + height;
        const next = new Set(base);
        for (const cell of el.querySelectorAll<HTMLElement>("[data-row-name]")) {
          const name = cell.getAttribute("data-row-name");
          if (!name) continue;
          const cr = cell.getBoundingClientRect();
          const itemLeft = cr.left - rect.left + el.scrollLeft;
          const itemTop = cr.top - rect.top + el.scrollTop;
          const itemRight = itemLeft + cr.width;
          const itemBottom = itemTop + cr.height;
          if (left < itemRight && boxRight > itemLeft && top < itemBottom && boxBottom > itemTop) {
            next.add(name);
          }
        }
        setSelected(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setIconMarquee(null);
        if (!moved && !additive) {
          setSelected(new Set());
          setAnchorIndex(null);
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [selected],
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

  const selectedEntries = useMemo(() => {
    const pool = viewMode === "tree"
      ? treeNodes.map((n) => n.entry)
      : sorted;
    return pool.filter((e) => e.name !== ".." && e.name !== "" && selected.has(e.name));
  }, [viewMode, treeNodes, sorted, selected]);

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

  // Open handler — always opens with the OS default app (local or remote).
  const handleOpen = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry) return;
    if (entry.kind === "dir") {
      onEnterDir?.(entry.name);
    } else if (effectiveMode === "local") {
      void invoke("fs_open", { path: `${path}/${entry.name}` }).catch((e) =>
        toast.error(`No se pudo abrir ${entry.name}: ${describeError(e)}`),
      );
    } else if (sessionId != null) {
      const fullPath = `${path}/${entry.name}`;
      setRemoteLoading(true);
      void openRemoteFile?.(sessionId, fullPath)
        .catch((e) => toast.error(`No se pudo abrir ${entry.name}: ${describeError(e)}`))
        .finally(() => setRemoteLoading(false));
    }
  }, [selectedEntries, onEnterDir, effectiveMode, path, sessionId, openRemoteFile]);

  // Edit handler — always opens in Terax's own editor (local or remote).
  const handleEdit = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry || entry.kind === "dir") return;
    if (effectiveMode === "local") {
      onOpenFile?.(`${path}/${entry.name}`);
    } else if (sessionId != null) {
      const fullPath = `${path}/${entry.name}`;
      setRemoteLoading(true);
      void editRemoteFile?.(sessionId, fullPath)
        .catch((e) => toast.error(`No se pudo editar ${entry.name}: ${describeError(e)}`))
        .finally(() => setRemoteLoading(false));
    }
  }, [selectedEntries, effectiveMode, path, sessionId, editRemoteFile, onOpenFile]);

  // Open with... — native app picker (always, even for text files).
  const handleOpenWith = useCallback(() => {
    const entry = selectedEntries[0];
    if (!entry || entry.kind === "dir") return;
    if (effectiveMode === "local") {
      void invoke("fs_open_with", { path: `${path}/${entry.name}` }).catch((e) =>
        toast.error(`No se pudo abrir ${entry.name}: ${describeError(e)}`),
      );
    } else if (sessionId != null) {
      const fullPath = `${path}/${entry.name}`;
      setRemoteLoading(true);
      void openRemoteFileWith?.(sessionId, fullPath)
        .catch((e) => toast.error(`No se pudo abrir ${entry.name}: ${describeError(e)}`))
        .finally(() => setRemoteLoading(false));
    }
  }, [selectedEntries, effectiveMode, path, sessionId, openRemoteFileWith]);

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
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          {viewMode === "list" && (
            <div className="flex h-6 shrink-0 items-center gap-2 overflow-hidden border-b border-border/60 px-2 text-[11px] font-medium text-muted-foreground">
              {/* 16px spacer matches the file-icon column in rows */}
              <div className="size-4 shrink-0" />
              <SortHeader
                column="name"
                label="Name"
                sort={sort}
                onSort={(column) => setSort((current) => nextSftpSort(current, column))}
                className="min-w-0 flex-1"
              />
              {(["size", "mtime", "permissions"] as const).map((col) => {
                const labels = { size: "Size", mtime: "Modified", permissions: "Permissions" } as const;
                return (
                  <div
                    key={col}
                    className="relative shrink-0"
                    style={{ width: `var(${COL_VAR[col]}, ${DEFAULT_COL_WIDTHS[col]}px)` }}
                  >
                    <ResizeHandle
                      col={col}
                      startWidth={colWidths[col]}
                      containerRef={paneRootRef}
                      onResize={handleResize}
                    />
                    <SortHeader
                      column={col}
                      label={labels[col]}
                      sort={sort}
                      onSort={(column) => setSort((current) => nextSftpSort(current, column))}
                      className="w-full"
                      align="right"
                    />
                  </div>
                );
              })}
            </div>
          )}

          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                onMouseDown={
                  viewMode === "list"
                    ? onListMouseDown
                    : viewMode === "icons"
                      ? onIconMouseDown
                      : undefined
                }
                className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
              >
                {viewMode === "list" ? (
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
                            viewMode="list"
                            colWidths={colWidths}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : viewMode === "tree" ? (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((vr) => {
                      const node = treeNodes[vr.index];
                      if (!node) return null;
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
                          <TreeRow
                            node={node}
                            selected={selected.has(node.entry.name)}
                            expanded={expandedPaths.has(node.fullPath)}
                            loading={loadingPaths.has(node.fullPath)}
                            onMouseDown={(e) => onRowMouseDown(vr.index, e)}
                            onDoubleClick={() => {
                              if (node.entry.kind === "dir") {
                                toggleExpand(node.fullPath, node.entry);
                              } else {
                                handleRowDoubleClick(node.entry);
                              }
                            }}
                            onToggle={(e) => {
                              e.stopPropagation();
                              toggleExpand(node.fullPath, node.entry);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    {iconMarquee && (
                      <div
                        className="pointer-events-none absolute z-10 bg-primary/15 ring-1 ring-inset ring-primary/40"
                        style={{
                          left: iconMarquee.left,
                          top: iconMarquee.top,
                          width: iconMarquee.width,
                          height: iconMarquee.height,
                        }}
                      />
                    )}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
                        gap: "2px",
                        padding: "6px",
                      }}
                    >
                      {sorted.map((entry, index) => {
                        const isPhantom = entry.name === "";
                        const isRenaming =
                          inlineEdit?.kind === "rename" &&
                          inlineEdit.originalName === entry.name;
                        return (
                          <SftpFileRow
                            key={entry.name || `phantom-${index}`}
                            entry={entry}
                            selected={selected.has(entry.name)}
                            now={now}
                            onMouseDown={(e) => onRowMouseDown(index, e)}
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
                            viewMode="icons"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

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
                onClick={handleEdit}
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
                disabled={selectedEntries.filter((e) => e.name !== "..").length === 0}
                onClick={() => {
                  const toDup = selectedEntries.filter((e) => e.name !== "..");
                  if (toDup.length > 0) onDuplicate?.(makePaneRef(), toDup);
                }}
              >
                Duplicate
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
                disabled={selectedEntries.length === 0}
                onClick={() => {
                  const paths = selectedEntries.map((e) =>
                    path === "/" ? `/${e.name}` : `${path}/${e.name}`,
                  );
                  void navigator.clipboard.writeText(paths.join("\n"));
                }}
              >
                Copy path
              </ContextMenuItem>
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
