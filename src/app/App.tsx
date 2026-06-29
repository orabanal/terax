import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import { AgentNotificationsBridge } from "@/modules/agents";
import {
  AgentRunBridge,
  AiSidebar,
  LocalAgentNotificationsBridge,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  type SessionScope,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import {
  CommandPalette,
  createCommandPaletteActions,
} from "@/modules/command-palette";
import {
  NewEditorDialog,
  useEditorFileSync,
  type EditorPaneHandle,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import type { PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSftpTabVisible } from "@/modules/settings/store";
import {
  ShortcutsDialog,
  useGlobalShortcuts,
  type ShortcutHandlers,
  type ShortcutId,
} from "@/modules/shortcuts";
import {
  SidebarRail,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import { StatusBar, type GitClickInfo } from "@/modules/statusbar";
import {
  MAX_PANES_PER_TAB,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  ComposeBar,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import { parseGitDiff, type ParsedGitDiff } from "@/modules/terminal/lib/gitDiffParser";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { useWorkspaceEnvStore, currentWorkspaceEnv } from "@/modules/workspace";
import type { SshHost } from "@/modules/ssh/store";
import { getSshPassword } from "@/modules/ssh/store";
import type { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseDialogs } from "./components/CloseDialogs";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

type GitDiffSource = {
  repoRoot: string | null;
  sshCwd: string | null;
  leafId: number | null;
  isSSH: boolean;
};

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    newBlockTab,
    newAgentTab,
    newPrivateTab,
    newSshTab,
    ensureSftpTab,
    removeSftpTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    extractLeafToTab,
    cloneTab,
    moveTab,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const { home, launchCwd, launchCwdResolved, switchWorkspace } =
    useWorkspaceSwitcher({
      tabsRef,
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      clearWorkspaceState,
    });

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [composeBarOpen, setComposeBarOpen] = useState(false);
  const toggleComposeBar = useCallback(
    () => setComposeBarOpen((v) => !v),
    [],
  );
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  // Per-tab AI sidebar open state
  const aiSidebarOpenRef = useRef<Map<number, boolean>>(new Map());
  const [, setAiSidebarOpenVersion] = useState(0);
  const aiSidebarOpen = aiSidebarOpenRef.current.get(activeId) ?? false;

  const toggleAiSidebar = useCallback(() => {
    const map = aiSidebarOpenRef.current;
    const current = map.get(activeId) ?? false;
    map.set(activeId, !current);
    setAiSidebarOpenVersion((v) => v + 1);
  }, [activeId]);

  const openAiSidebar = useCallback(() => {
    if (!(aiSidebarOpenRef.current.get(activeId) ?? false)) {
      aiSidebarOpenRef.current.set(activeId, true);
      setAiSidebarOpenVersion((v) => v + 1);
    }
  }, [activeId]);

  const { hasComposer } = useAiBootstrap();

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";
  const activeByScope = useChatStore((s) => s.activeByScope);
  const aiSessions = useChatStore((s) => s.sessions);
  const activeAiScope = useMemo<SessionScope | null>(() => {
    if (!activeTab) return null;
    if (activeTab.kind === "terminal") {
      if (activeLeafId == null) return null;
      // SSH tabs encode the host ID in the scope so sessions for different
      // servers never mix, and sessions survive app restarts for the same host.
      const targetId = activeTab.sshHostId
        ? `${activeLeafId}:ssh:${activeTab.sshHostId}`
        : String(activeLeafId);
      return { type: "terminal", targetId };
    }
    return activeId != null
      ? { type: "workspace", targetId: String(activeId) }
      : null;
  }, [activeTab, activeId, activeLeafId]);
  const openAiScopeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const tab of tabs) {
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) {
          const key = tab.sshHostId
            ? `terminal:${leafId}:ssh:${tab.sshHostId}`
            : `terminal:${leafId}`;
          keys.add(key);
        }
      } else {
        keys.add(`workspace:${tab.id}`);
      }
    }
    return keys;
  }, [tabs]);
  const aiBridgeSessionIds = useMemo(() => {
    const validIds = new Set(aiSessions.map((s) => s.id));
    const ids = new Set<string>();
    for (const [key, id] of Object.entries(activeByScope)) {
      if (openAiScopeKeys.has(key) && validIds.has(id)) ids.add(id);
    }
    return Array.from(ids);
  }, [activeByScope, aiSessions, openAiScopeKeys]);

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    saveAndClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab, editorRefs });

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [tabs, activeId, setActiveId],
  );

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    toggleAiSidebar();
  }, [hasComposer, toggleAiSidebar]);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openAiSidebar();
    },
    [hasComposer, openAiSidebar],
  );

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openNewBlockTab = useCallback(() => {
    newBlockTab(inheritedCwdForNewTab());
  }, [newBlockTab, inheritedCwdForNewTab]);

  const openNewSshTab = useCallback(
    async (host: SshHost) => {
      if (host.authType === "password") {
        const saved = await getSshPassword(host.id);
        if (saved) {
          newSshTab({ ...host, password: saved });
        } else {
          openSettingsWindow("ssh");
        }
      } else {
        newSshTab(host);
      }
    },
    [newSshTab],
  );

  // The single SFTP tab is driven by a persisted preference: on toggle we
  // write the pref, and an effect reconciles tab existence with it (so the
  // tab also appears/disappears when the flag is changed from Settings).
  const sftpTabVisible = usePreferencesStore((s) => s.sftpTabVisible);
  const sftpPrefHydrated = usePreferencesStore((s) => s.hydrated);
  useEffect(() => {
    if (!sftpPrefHydrated) return;
    if (sftpTabVisible) ensureSftpTab();
    else removeSftpTab();
  }, [sftpPrefHydrated, sftpTabVisible, ensureSftpTab, removeSftpTab]);

  const toggleSftpTab = useCallback(() => {
    void setSftpTabVisible(!usePreferencesStore.getState().sftpTabVisible);
  }, []);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (tab?.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Explorer defaults to preview (pin=false); explicit actions like
      // context-menu "Open" pass pin=true for a persistent tab.
      openFileTab(path, pin ?? false);
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;

  // SSH CWD detected by useGitSummary inside StatusBar (via /proc on the remote).
  // Updated via onSshCwdChange prop; reset when the active leaf changes.
  const [activeSshCwd, setActiveSshCwd] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeLeafId is the trigger, setActiveSshCwd is stable
  useEffect(() => {
    setActiveSshCwd(null);
  }, [activeLeafId]);

  const isActiveSSH = activeTerminalTab?.sshHost != null;
  const activeSshId =
    isActiveSSH && activeLeafId !== null ? ptyIdForLeaf(activeLeafId) : null;
  const activeTerminalSshGitCtx =
    isActiveSSH && activeSshId !== null && activeSshCwd !== null && activeLeafId !== null
      ? { sshId: activeSshId, cwd: activeSshCwd, leafId: activeLeafId }
      : undefined;

  const { sourceControl, toggleSourceControl, openGitGraphFromContext, sshGitCtx: scmSshCtx } =
    useSourceControlContext({
      activeTab,
      tabs,
      activeTerminalLeafCwd,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      cycleSidebarView,
      openCommitHistoryTab,
      sshGitCtx: activeTerminalSshGitCtx,
    });

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      newMarkdownTab(path);
    },
    [newMarkdownTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (t?.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const [gitDiffOpen, setGitDiffOpen] = useState(false);
  const [gitDiffData, setGitDiffData] = useState<ParsedGitDiff | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffBranch, setGitDiffBranch] = useState<string | null>(null);
  const gitDiffSourceRef = useRef<GitDiffSource | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId is the trigger; the body doesn't need its value
  useEffect(() => {
    setGitDiffOpen(false);
  }, [activeId]);

  const fetchGitDiff = useCallback(async (source: GitDiffSource) => {
    setGitDiffLoading(true);
    try {
      let raw = "";
      if (source.isSSH && source.sshCwd && source.leafId !== null) {
        const sshId = ptyIdForLeaf(source.leafId);
        if (sshId !== null) {
          const safeCwd = source.sshCwd.replace(/'/g, "'\\''");
          const cmd = `cd '${safeCwd}' && git --no-pager diff HEAD --unified=3 --no-color 2>/dev/null`;
          const result = await Promise.race([
            invoke<{ stdout: string; stderr: string; exitCode: number | null }>("ssh_exec", {
              id: sshId,
              command: cmd,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), 20_000),
            ),
          ]);
          raw = result.stdout;
        }
      } else if (!source.isSSH && source.repoRoot) {
        const result = await invoke<{ diffText: string; truncated: boolean }>("git_diff", {
          repoRoot: source.repoRoot,
          path: null,
          staged: false,
          workspace: currentWorkspaceEnv(),
        });
        raw = result.diffText;
      }
      setGitDiffData(parseGitDiff(raw));
    } catch {
      setGitDiffData(null);
    } finally {
      setGitDiffLoading(false);
    }
  }, []);

  // Opens the editor-style diff tab for a single file over SSH.
  const handleSshFileDiff = useCallback(
    async (input: {
      path: string;
      repoRoot: string;
      mode: "+" | "-";
      originalPath: string | null;
      title?: string;
    }) => {
      const ctx = activeTerminalSshGitCtx;
      if (!ctx) return;
      try {
        const { sshGitDiffContent } = await import("@/modules/source-control/lib/sshGit");
        const content = await sshGitDiffContent(
          ctx,
          input.repoRoot,
          input.path,
          input.mode === "+",
          input.originalPath,
        );
        openGitDiffTab({
          path: input.path,
          repoRoot: input.repoRoot,
          mode: input.mode,
          originalPath: input.originalPath,
          title: input.title,
          sshDiffContent: content,
        });
      } catch {
        // Fallback: show whole-repo diff in the bottom panel if per-file fetch fails
        setGitDiffLoading(true);
        setGitDiffOpen(true);
        setGitDiffBranch(input.title ?? input.path);
        gitDiffSourceRef.current = {
          repoRoot: input.repoRoot,
          sshCwd: ctx.cwd,
          leafId: activeLeafId,
          isSSH: true,
        };
        try {
          const { sshGitDiff } = await import("@/modules/source-control/lib/sshGit");
          const result = await sshGitDiff(ctx, input.repoRoot, input.path, input.mode === "+");
          setGitDiffData(parseGitDiff(result.diffText));
        } catch {
          setGitDiffData(null);
        } finally {
          setGitDiffLoading(false);
        }
      }
    },
    [activeLeafId, activeTerminalSshGitCtx, openGitDiffTab],
  );

  const handleGitClick = useCallback((info: GitClickInfo) => {
    if (gitDiffOpen) {
      setGitDiffOpen(false);
      return;
    }
    const source: GitDiffSource = {
      repoRoot: info.repoRoot,
      sshCwd: info.sshCwd,
      leafId: info.leafId,
      isSSH: info.isSSH,
    };
    gitDiffSourceRef.current = source;
    setGitDiffBranch(info.branch);
    setGitDiffOpen(true);
    void fetchGitDiff(source);
  }, [fetchGitDiff, gitDiffOpen]);

  const handleGitRefresh = useCallback(() => {
    if (gitDiffSourceRef.current) {
      void fetchGitDiff(gitDiffSourceRef.current);
    }
  }, [fetchGitDiff]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "tab.new": openNewTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.composeBar": toggleComposeBar,
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      cycleTab,
      handleCloseTabOrPane,
      openNewTab,
      openNewPrivateTab,
      openPreviewTab,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      toggleComposeBar,
      toggleSourceControl,
      togglePanelAndFocus,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      if (id === "terminal.composeBar") {
        return activeTab?.kind !== "terminal";
      }
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) editorRefs.current.set(id, h);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const onActivateLocalAgent = useCallback(() => {
    openAiSidebar();
  }, [openAiSidebar]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const handleCloneTab = useCallback(
    (id: number) => {
      cloneTab(id);
    },
    [cloneTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const commandPaletteActions = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandPaletteActions({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            home,
            openNewTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            closeActiveTabOrPane: handleCloseTabOrPane,
            nextTab: () => cycleTab(1),
            previousTab: () => cycleTab(-1),
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusNextPane: () => focusNextPaneInTab(activeId, 1),
            focusPreviousPane: () => focusNextPaneInTab(activeId, -1),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            toggleAi: togglePanelAndFocus,
            toggleComposeBar,
            openSettings: () => void openSettingsWindow(),
            openShortcuts: () => setShortcutsOpen(true),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewPrivateTab,
      openPreviewTab,
      handleCloseTabOrPane,
      cycleTab,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      toggleSidebar,
      togglePanelAndFocus,
      toggleComposeBar,
    ],
  );

  const activeCwd = activeTerminalLeafCwd;

  useAiLiveBridge({
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
  });

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onNewSsh={openNewSshTab}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onClone={handleCloneTab}
              onMoveTab={moveTab}
              sftpVisible={sftpTabVisible}
              onToggleSftp={toggleSftpTab}
              onToggleSidebar={toggleSidebar}
              onSplit={splitActivePaneInActiveTab}
              canSplit={
                activeTerminalTab !== null &&
                leafIds(activeTerminalTab.paneTree).length < MAX_PANES_PER_TAB
              }
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidthRef.current}px`}
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                }}
              >
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <div className="min-h-0 flex-1">
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerRoot}
                        activeFilePath={explorerActiveFilePath}
                        onOpenFile={handleOpenFile}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                        onAttachToAgent={handleAttachFileToAgent}
                        onOpenMarkdownPreview={openMarkdownPreview}
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={scmSshCtx ? handleSshFileDiff : openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                        onOpenFile={handleOpenFile}
                        sshGitCtx={scmSshCtx}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="relative min-h-0 flex-1 overflow-hidden">
                    <WorkspaceSurface
                      tabs={tabs}
                      activeId={activeId}
                      activeTab={activeTab}
                      registerTerminalHandle={registerTerminalHandle}
                      onSearchReady={handleSearchReady}
                      onCwd={handleTerminalCwd}
                      onExit={handleLeafExit}
                      onFocusLeaf={handleFocusLeaf}
                      splitPane={splitActivePane}
                      closePane={closePaneByLeaf}
                      extractToTab={extractLeafToTab}
                      registerEditorHandle={registerEditorHandle}
                      onEditorDirtyChange={handleEditorDirty}
                      onEditorCloseTab={disposeTab}
                      registerPreviewHandle={registerPreviewHandle}
                      onPreviewUrlChange={handlePreviewUrl}
                      onAiDiffAccept={(id) => respondToApproval(id, true)}
                      onAiDiffReject={(id) => respondToApproval(id, false)}
                      onOpenCommitFile={openCommitFileDiffTab}
                      onGitHistorySearchHandle={setGitHistoryHandle}
                      onOpenFile={handleOpenFile}
                      gitDiffPanel={{
                        open: gitDiffOpen && isTerminalTab,
                        onClose: () => setGitDiffOpen(false),
                        data: gitDiffData,
                        loading: gitDiffLoading,
                        branch: gitDiffBranch,
                        onRefresh: handleGitRefresh,
                      }}
                    />
                  </div>
                  {!zenMode && composeBarOpen && activeLeafId !== null && (
                    <ComposeBar
                      onSend={(text) => {
                        writeToSession(activeLeafId, `${text}\r`);
                      }}
                      onClose={() => {
                        setComposeBarOpen(false);
                        terminalRefs.current.get(activeLeafId)?.focus();
                      }}
                    />
                  )}
                </div>
                  <AiSidebar
                    open={aiSidebarOpen}
                    onToggle={toggleAiSidebar}
                    hasComposer={hasComposer}
                    scopeType={activeAiScope?.type ?? "workspace"}
                    scopeTargetId={activeAiScope?.targetId ?? null}
                    activeLeafId={activeLeafId}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={switchWorkspace}
              onOpenMini={togglePanelAndFocus}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
              leafId={activeLeafId}
              isSSH={activeTerminalTab?.sshHost != null}
              onGitClick={isTerminalTab ? handleGitClick : undefined}
              isComposeBarOpen={composeBarOpen}
              onToggleComposeBar={toggleComposeBar}
              onSshCwdChange={setActiveSshCwd}
            />
          )}

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                sessionIds={aiBridgeSessionIds}
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            actions={commandPaletteActions}
            workspaceRoot={explorerRoot}
            onOpenFile={handleOpenFile}
          />

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            onSaveAndClose={saveAndClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
