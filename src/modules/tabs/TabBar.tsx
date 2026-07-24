import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useSshHostsStore, type SshHost } from "@/modules/ssh/store";
import {
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  Copy01Icon,
  FolderTransferIcon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab } from "./lib/useTabs";

type DragState = {
  tabId: number;
  startIndex: number;
  startX: number;
  /** True once the mouse has moved past the drag threshold. */
  active: boolean;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onNewSsh: (host: SshHost) => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Clone a terminal tab, replicating its connection and cwd. */
  onClone: (id: number) => void;
  /** Reorder tabs by moving tabId to position toIndex in the full tabs array. */
  onMoveTab: (tabId: number, toIndex: number) => void;
  /** Whether the pinned SFTP tab is currently shown. */
  sftpVisible: boolean;
  /** Toggle the pinned SFTP tab on/off. */
  onToggleSftp: () => void;
  compact?: boolean;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onNewSsh,
  onClose,
  onPin,
  onRename,
  onClone,
  onMoveTab,
  sftpVisible,
  onToggleSftp,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // The SFTP tab is rendered as a fixed element outside the scrollable area so
  // it stays visible at all times.  The remaining tabs scroll independently.
  const sftpTab = tabs.find((t) => t.kind === "sftp") ?? null;
  const scrollableTabs = sftpTab
    ? tabs.filter((t) => t.kind !== "sftp")
    : tabs;

  // --- Drag-and-drop tab reordering (ref-based, no stale closures) ---
  const dragRef = useRef<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const tabsRef = useRef(scrollableTabs);
  tabsRef.current = scrollableTabs;
  const onMoveTabRef = useRef(onMoveTab);
  onMoveTabRef.current = onMoveTab;
  const sftpTabRef = useRef(sftpTab);
  sftpTabRef.current = sftpTab;
  const scrollRefForDrag = scrollRef;

  const resolveDropIndex = useCallback(
    (clientX: number): number | null => {
      const container = scrollRefForDrag.current;
      if (!container) return null;
      const triggers = container.querySelectorAll<HTMLElement>("[data-tab-id]");
      const currentTabs = tabsRef.current;
      for (const el of triggers) {
        const rect = el.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const tabId = Number(el.dataset.tabId);
        const idx = currentTabs.findIndex((t) => t.id === tabId);
        if (idx === -1) continue;
        if (clientX < midX) return idx;
      }
      return currentTabs.length;
    },
    [scrollRefForDrag],
  );

  useEffect(() => {
    const DRAG_THRESHOLD = 4;

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.active) {
        if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
        drag.active = true;
        setDraggedTabId(drag.tabId);
      }

      e.preventDefault();

      const idx = resolveDropIndex(e.clientX);
      setDropTarget(idx);
      setGhostPos({ x: e.clientX, y: e.clientY });

      // Auto-scroll when near edges
      const container = scrollRefForDrag.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const EDGE = 32;
        if (e.clientX < rect.left + EDGE) {
          container.scrollLeft -= 8;
        } else if (e.clientX > rect.right - EDGE) {
          container.scrollLeft += 8;
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const wasActive = drag.active;
      const startIndex = drag.startIndex;

      dragRef.current = null;
      setDraggedTabId(null);
      setDropTarget(null);
      setGhostPos(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (!wasActive) return;
      e.preventDefault();
      e.stopPropagation();

      const toIndex = resolveDropIndex(e.clientX);
      if (toIndex !== null && toIndex !== startIndex) {
        // Convert scrollableTabs index to full tabs array index
        const sftpOffset = sftpTabRef.current ? 1 : 0;
        const adjustedTo = toIndex > startIndex ? toIndex - 1 : toIndex;
        const fullToIndex = adjustedTo + sftpOffset;
        onMoveTabRef.current(drag.tabId, fullToIndex);
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [resolveDropIndex, scrollRefForDrag]);

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, tabId: number) => {
      if (e.button !== 0 || editingId !== null) return;
      const idx = tabsRef.current.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      dragRef.current = { tabId, startIndex: idx, startX: e.clientX, active: false };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    [editingId],
  );
  // --- End drag-and-drop ---
  const sshHosts = useSshHostsStore((s) => s.hosts);
  const sshHydrated = useSshHostsStore((s) => s.hydrated);
  const sshInit = useSshHostsStore((s) => s.init);
  const sshReload = useSshHostsStore((s) => s.reload);

  useEffect(() => {
    sshInit();
  }, [sshInit]);

  // Settings runs in a separate Tauri window — its Zustand store is a different
  // JS context. Watch the underlying JSON file so changes made in Settings are
  // picked up here without a restart.
  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/plugin-store").then(({ LazyStore }) => {
      const s = new LazyStore("terax-ssh-hosts.json");
      s.onChange(() => {
        if (!cancelled) void sshReload();
      });
    });
    return () => { cancelled = true; };
  }, [sshReload]);

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Track scroll position for fade indicators.
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 2;
    setCanScrollLeft(el.scrollLeft > threshold);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - threshold);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [updateScrollState]);

  // Re-evaluate scroll state when tabs change.
  useEffect(() => {
    const raf = requestAnimationFrame(updateScrollState);
    return () => cancelAnimationFrame(raf);
  }, [tabs.length, activeId, updateScrollState]);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.5;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }, []);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const draggedTab = draggedTabId !== null
    ? scrollableTabs.find((t) => t.id === draggedTabId) ?? null
    : null;

  return (
    <>
    <div
      data-tauri-drag-region
      className="flex min-w-0 shrink items-center"
    >
      {sftpTab && (
        <button
          type="button"
          data-tab-id={sftpTab.id}
          onClick={() => onSelect(sftpTab.id)}
          className={cn(
            "group flex h-7 shrink-0 items-center gap-1.5 rounded-md text-xs transition-colors hover:text-foreground/80",
            sftpTab.id === activeId
              ? "bg-accent text-foreground"
              : "text-muted-foreground",
            compact ? "px-1.5" : "px-2",
          )}
        >
          <TabIcon tab={sftpTab} />
          <span className="truncate">{labelFor(sftpTab)}</span>
        </button>
      )}
      <div className="relative min-w-0 shrink">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollTabs("left")}
            className="absolute left-0 top-0 bottom-0 z-10 flex w-6 items-center justify-center bg-gradient-to-r from-background/90 to-transparent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Scroll tabs left"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2L4 6L8 10" />
            </svg>
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollTabs("right")}
            className="absolute right-0 top-0 bottom-0 z-10 flex w-6 items-center justify-center bg-gradient-to-l from-background/90 to-transparent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Scroll tabs right"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2L8 6L4 10" />
            </svg>
          </button>
        )}
      <div
        ref={scrollRef}
        className="min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max items-center gap-0.5">
          <Tabs
            value={String(activeId)}
            onValueChange={(v) => onSelect(Number(v))}
          >
            <TabsList className="h-7 w-max gap-0.5 bg-transparent p-0">
              {scrollableTabs.map((t, tabIndex) => {
              const isPreview = t.kind === "editor" && (t as EditorTab).preview;
              const isActive = t.id === activeId;
              const isDragged = draggedTabId === t.id;
              // The SFTP tab is pinned and managed by the "Show SFTP" toggle,
              // so it never shows the inline close affordance.
              const closable = tabs.length > 1 && t.kind !== "sftp";

              const dropIndicator =
                dropTarget === tabIndex ? (
                  <div className="w-0.5 shrink-0 self-stretch rounded-full bg-primary" />
                ) : null;

              // While renaming, render a non-button cell so the <input> is not
              // nested inside the trigger <button> (invalid HTML, and WebKit
              // blocks focus/selection on inputs inside buttons).
              if (editingId === t.id && t.kind === "terminal") {
                return (
                  <div
                    key={t.id}
                    data-tab-id={t.id}
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent text-xs text-foreground",
                      compact ? "px-1.5" : "px-2",
                    )}
                  >
                    <TabIcon tab={t} />
                    <TabRenameInput
                      initial={labelFor(t)}
                      onCommit={(value) => {
                        onRename(t.id, value);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                );
              }

              // Terminal and editor tabs use a fixed width so they don't resize
              // when the working directory or file name changes.
              const fixedWidth =
                t.kind === "terminal" || t.kind === "editor" || t.kind === "markdown";

              const trigger = (
                <TabsTrigger
                  key={t.id}
                  value={String(t.id)}
                  data-tab-id={t.id}
                  onDoubleClick={() => isPreview && onPin(t.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && tabs.length > 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(t.id);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                    handleTabMouseDown(e, t.id);
                  }}
                  className={cn(
                    "group h-7 shrink-0 gap-1.5 rounded-md text-xs transition-colors hover:text-foreground/80 justify-between",
                    isDragged && "opacity-40",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                    fixedWidth && (compact ? "w-32" : "w-40"),
                    compact
                      ? "px-1.5!"
                      : tabs.length === 1 && !fixedWidth
                        ? "px-2!"
                        : "ps-2! pe-1!",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-1.5 truncate",
                      compact ? "max-w-48" : "max-w-80",
                    )}
                  >
                    <TabIcon tab={t} />
                    {/* Preview tabs use italic to signal the transient state,
                        matching the visual convention from VSCode. */}
                    <span className={cn("truncate", isPreview && "italic")}>
                      {labelFor(t)}
                    </span>
                    {t.kind === "editor" && t.dirty ? (
                      <span
                        aria-label="Unsaved changes"
                        className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                      />
                    ) : null}
                  </span>
                  {closable && (
                    <span
                      role="button"
                      aria-label="Close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.id);
                      }}
                      className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={11}
                        strokeWidth={2}
                      />
                    </span>
                  )}
                </TabsTrigger>
              );

              if (t.kind !== "terminal") return <Fragment key={t.id}>{dropIndicator}{trigger}</Fragment>;

              return (
                <Fragment key={t.id}>{dropIndicator}<ContextMenu>
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuItem onSelect={() => setEditingId(t.id)}>
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Rename</span>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onClone(t.id)}>
                      <HugeiconsIcon
                        icon={Copy01Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Clone tab</span>
                    </ContextMenuItem>
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => onClose(t.id)}>
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={14}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Close</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu></Fragment>
              );
            })}
            {dropTarget === scrollableTabs.length && (
              <div className="w-0.5 shrink-0 self-stretch rounded-full bg-primary" />
            )}
          </TabsList>
        </Tabs>
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) requestAnimationFrame(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New tab"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56 max-h-[70vh] overflow-y-auto">
            <DropdownMenuItem onSelect={() => onNew()}>
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Terminal</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "T")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewBlock()}>
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Block terminal</span>
              <span className="text-xs text-muted-foreground">beta</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPrivate()}>
              <HugeiconsIcon
                icon={IncognitoIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Privacy</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "R")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewEditor()}>
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Editor</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "E")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPreview()}>
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Preview</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "P")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewGitGraph()}>
              <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Git Graph</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={sftpVisible}
              onCheckedChange={onToggleSftp}
            >
              <HugeiconsIcon
                icon={FolderTransferIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Show SFTP</span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {sshHydrated && sshHosts.length === 0 && (
              <DropdownMenuItem disabled>
                <HugeiconsIcon icon={ServerStack01Icon} size={14} strokeWidth={1.75} />
                <span className="flex-1 text-[#808080]">No SSH hosts configured</span>
              </DropdownMenuItem>
            )}
            {sshHosts.map((host) => (
              <DropdownMenuItem key={host.id} onSelect={() => onNewSsh(host)}>
                <HugeiconsIcon icon={ServerStack01Icon} size={14} strokeWidth={1.75} />
                <span className="flex-1 truncate">{host.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </div>
    </div>
    {draggedTab && ghostPos && createPortal(
      <div
        className="pointer-events-none fixed z-[9999] flex h-7 items-center gap-1.5 rounded-md bg-accent/90 px-2 text-xs text-foreground shadow-lg ring-1 ring-border/50 backdrop-blur-sm"
        style={{ left: ghostPos.x - 40, top: ghostPos.y - 14 }}
      >
        <TabIcon tab={draggedTab} />
        <span className="truncate">{labelFor(draggedTab)}</span>
      </div>,
      document.body,
    )}
    </>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? <img src={url} alt="" className="size-3.5 shrink-0" /> : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "terminal" && tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "terminal" && tab.sshHostId) {
    return (
      <HugeiconsIcon
        icon={ServerStack01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "sftp") {
    return (
      <HugeiconsIcon
        icon={FolderTransferIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename tab"
      className={cn(
        "w-28 min-w-0 rounded-sm bg-background px-1 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
