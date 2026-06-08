import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useState } from "react";
import { useSshHostsStore, type SshHost } from "@/modules/ssh/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SftpConflictDialog } from "./components/SftpConflictDialog";
import { SftpConnection } from "./components/SftpConnection";
import { SftpDragGhost } from "./components/SftpDragGhost";
import { SftpSubTabs } from "./components/SftpSubTabs";
import { SftpTransferQueue } from "./components/SftpTransferQueue";
import { SftpDragContext } from "./lib/SftpDragContext";
import { useSftpDragDrop } from "./lib/useSftpDragDrop";
import type { SftpPaneMode } from "./components/SftpPane";

type Connection = {
  id: string;
  mode: SftpPaneMode;
  hostId?: string;
};

let nextConnId = 1;
function newConnId() {
  return `conn-${nextConnId++}`;
}

export function SftpView({
  now,
  home,
  onOpenFile,
}: {
  now: number;
  home: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const { hosts, init } = useSshHostsStore();
  const sftpCloseOnComplete = usePreferencesStore((s) => s.sftpCloseOnComplete);
  useEffect(() => {
    void init();
  }, [init]);

  const [leftConns, setLeftConns] = useState<Connection[]>([
    { id: newConnId(), mode: "local" },
  ]);
  const [leftActive, setLeftActive] = useState(0);

  const [rightConns, setRightConns] = useState<Connection[]>([
    { id: newConnId(), mode: "local" },
  ]);
  const [rightActive, setRightActive] = useState(0);

  const [focusedSide, setFocusedSide] = useState<"left" | "right">("left");

  const { context: dragContext, queue } = useSftpDragDrop();

  // Refresh the destination pane after each completed transfer. Panes own their
  // own refresh; we re-emit a lightweight signal the connections listen for.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    return queue.onDidComplete(() => setRefreshTick((t) => t + 1));
  }, [queue]);

  const closeConnection = useCallback(
    (side: "left" | "right", index: number) => {
      if (side === "left") {
        setLeftConns((prev) => {
          if (prev.length <= 1) return prev;
          const next = prev.filter((_, i) => i !== index);
          setLeftActive((a) => Math.min(a, next.length - 1));
          return next;
        });
      } else {
        setRightConns((prev) => {
          if (prev.length <= 1) return prev;
          const next = prev.filter((_, i) => i !== index);
          setRightActive((a) => Math.min(a, next.length - 1));
          return next;
        });
      }
    },
    [],
  );

  const addConnection = useCallback(
    (side: "left" | "right", conn: Connection) => {
      const setter = side === "left" ? setLeftConns : setRightConns;
      const setActive = side === "left" ? setLeftActive : setRightActive;
      setter((prev) => {
        const next = [...prev, conn];
        setActive(next.length - 1);
        return next;
      });
    },
    [],
  );

  const handleHostSelect = useCallback(
    (side: "left" | "right", host: SshHost) => {
      addConnection(side, {
        id: newConnId(),
        mode: "remote",
        hostId: host.id,
      });
    },
    [addConnection],
  );

  const handleLocal = useCallback(
    (side: "left" | "right") => {
      addConnection(side, { id: newConnId(), mode: "local" });
    },
    [addConnection],
  );

  const getConnectHost = useCallback(
    (conn: Connection): SshHost | null => {
      if (conn.mode !== "remote" || !conn.hostId) return null;
      return hosts.find((h) => h.id === conn.hostId) ?? null;
    },
    [hosts],
  );

  const makeSubTabs = useCallback(
    (conns: Connection[]) =>
      conns.map((c) => ({
        id: c.id,
        label:
          c.mode === "local"
            ? "Local"
            : (hosts.find((h) => h.id === c.hostId)?.name ?? "Remote"),
      })),
    [hosts],
  );

  return (
    <SftpDragContext.Provider value={dragContext}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-card px-2">
          <span className="text-xs font-medium text-foreground/80">SFTP</span>
        </div>

        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="sftp-left" defaultSize="50%" minSize="20%">
            <div data-sftp-side="left" className="flex h-full flex-col">
              <SftpSubTabs
                tabs={makeSubTabs(leftConns)}
                activeIndex={leftActive}
                onSelect={setLeftActive}
                onClose={(i) => closeConnection("left", i)}
                canClose={leftConns.length > 1}
              />
              <div className="min-h-0 flex-1">
                {leftConns.map((conn, i) => (
                  <SftpConnection
                    key={conn.id}
                    connKey={conn.id}
                    mode={conn.mode}
                    home={home}
                    visible={i === leftActive}
                    focused={focusedSide === "left"}
                    onFocus={() => setFocusedSide("left")}
                    now={now}
                    hosts={hosts}
                    onHostSelect={(h) => handleHostSelect("left", h)}
                    onLocal={() => handleLocal("left")}
                    connectToHost={getConnectHost(conn)}
                    onOpenFile={onOpenFile}
                    refreshTick={refreshTick}
                    enqueueRemoteEditUpload={queue.enqueueRemoteEditUpload}
                  />
                ))}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="sftp-right" defaultSize="50%" minSize="20%">
            <div data-sftp-side="right" className="flex h-full flex-col">
              <SftpSubTabs
                tabs={makeSubTabs(rightConns)}
                activeIndex={rightActive}
                onSelect={setRightActive}
                onClose={(i) => closeConnection("right", i)}
                canClose={rightConns.length > 1}
              />
              <div className="min-h-0 flex-1">
                {rightConns.map((conn, i) => (
                  <SftpConnection
                    key={conn.id}
                    connKey={conn.id}
                    mode={conn.mode}
                    home={home}
                    visible={i === rightActive}
                    focused={focusedSide === "right"}
                    onFocus={() => setFocusedSide("right")}
                    now={now}
                    hosts={hosts}
                    onHostSelect={(h) => handleHostSelect("right", h)}
                    onLocal={() => handleLocal("right")}
                    connectToHost={getConnectHost(conn)}
                    onOpenFile={onOpenFile}
                    refreshTick={refreshTick}
                    enqueueRemoteEditUpload={queue.enqueueRemoteEditUpload}
                  />
                ))}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <SftpTransferQueue
          transfers={queue.transfers}
          onCancel={queue.cancel}
          onRetry={queue.retry}
          onClearFinished={queue.clearFinished}
          autoCloseOnComplete={sftpCloseOnComplete}
        />
        <SftpConflictDialog
          open={queue.currentConflict !== null}
          onOpenChange={(open) => {
            if (!open && queue.currentConflict) {
              queue.resolveConflict(queue.currentConflict.id, "skip", false);
            }
          }}
          fileName={queue.currentConflict?.fileName}
          now={now}
          onResolve={(action, applyToAll) => {
            if (queue.currentConflict) {
              queue.resolveConflict(queue.currentConflict.id, action, applyToAll);
            }
          }}
        />
        <SftpDragGhost />
      </div>
    </SftpDragContext.Provider>
  );
}
