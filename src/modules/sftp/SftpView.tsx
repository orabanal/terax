import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useState } from "react";
import { useSshHostsStore, type SshHost } from "@/modules/ssh/store";
import { SftpConflictDialog } from "./components/SftpConflictDialog";
import { SftpConnection } from "./components/SftpConnection";
import { SftpDeleteDialog } from "./components/SftpDeleteDialog";
import { SftpNameDialog } from "./components/SftpNameDialog";
import { SftpPermissionsDialog } from "./components/SftpPermissionsDialog";
import { SftpSubTabs } from "./components/SftpSubTabs";
import { SftpTransferQueue } from "./components/SftpTransferQueue";
import { MOCK_TRANSFERS } from "./lib/mockData";
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

export function SftpView({ now, home }: { now: number; home: string | null }) {
  const { hosts, init } = useSshHostsStore();
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-card px-2">
        <span className="text-xs font-medium text-foreground/80">SFTP</span>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="sftp-left" defaultSize="50%" minSize="20%">
          <div className="flex h-full flex-col">
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
                />
              ))}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="sftp-right" defaultSize="50%" minSize="20%">
          <div className="flex h-full flex-col">
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
                />
              ))}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <SftpTransferQueue transfers={MOCK_TRANSFERS} />

      <SftpDialogs now={now} />
    </div>
  );
}

function SftpDialogs({ now }: { now: number }) {
  const [noop] = useState(false);
  return (
    <>
      <SftpNameDialog open={noop} onOpenChange={() => {}} mode="new-folder" />
      <SftpPermissionsDialog open={noop} onOpenChange={() => {}} />
      <SftpDeleteDialog open={noop} onOpenChange={() => {}} />
      <SftpConflictDialog
        open={noop}
        onOpenChange={() => {}}
        now={now}
        existing={{ size: 1536, mtime: now - 86_400_000 }}
        incoming={{ size: 2048, mtime: now }}
      />
    </>
  );
}
