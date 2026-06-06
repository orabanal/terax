import type { Tab } from "@/modules/tabs";
import type { SplitDir } from "@/modules/terminal/lib/panes";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { leafIds } from "./lib/panes";
import { SshConnectingModal } from "@/modules/ssh/SshConnectingModal";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
  splitPane: (tabId: number, dir: SplitDir) => void;
  closePane: (leafId: number) => void;
  extractToTab: (tabId: number, leafId: number) => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  splitPane,
  closePane,
  extractToTab,
}: Props) {
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );

  // hover state lives here, keyed by tab id, so all panes in a tab share it
  const [hoveredByTab, setHoveredByTab] = useState<Record<number, number | null>>({});

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  useEffect(() => {
    const live = new Set<number>();
    for (const t of terminals) for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        const command = t.kind === "terminal" ? t.command : undefined;
        const sshHost = t.kind === "terminal" ? t.sshHost : undefined;
        const activeLeafId = t.kind === "terminal" ? t.activeLeafId : 0;
        const leaves = leafIds(t.paneTree);
        const multiPane = leaves.length > 1;
        const hoveredLeafId = hoveredByTab[t.id] ?? null;
        return (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
            }}
            aria-hidden={!tabVisible}
          >
            <PaneTreeView
              node={t.paneTree}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              blocks={t.blocks ?? false}
              command={command}
              sshHost={sshHost}
              onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
              getBundle={getBundle}
              hoveredLeafId={hoveredLeafId}
              onHoverLeaf={(leafId) =>
                setHoveredByTab((prev) => ({ ...prev, [t.id]: leafId }))
              }
              multiPane={multiPane}
              onSplit={(dir) => splitPane(t.id, dir)}
              onClosePane={(leafId) => closePane(leafId)}
              onExtractToTab={(leafId) => extractToTab(t.id, leafId)}
            />
            {sshHost && leaves.map((lid) => (
              <SshConnectingModal
                key={lid}
                leafId={lid}
                hostName={sshHost.name}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
