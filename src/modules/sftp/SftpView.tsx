import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useState } from "react";
import { useSshHostsStore } from "@/modules/ssh/store";
import { SftpConflictDialog } from "./components/SftpConflictDialog";
import { SftpDeleteDialog } from "./components/SftpDeleteDialog";
import { SftpHostPicker } from "./components/SftpHostPicker";
import { SftpNameDialog } from "./components/SftpNameDialog";
import { SftpPane } from "./components/SftpPane";
import { SftpPermissionsDialog } from "./components/SftpPermissionsDialog";
import { SftpTransferQueue } from "./components/SftpTransferQueue";
import { MOCK_TRANSFERS } from "./lib/mockData";
import type { SftpSide } from "./lib/types";
import { useLocalDir } from "./lib/useLocalDir";
import { useRemoteDir } from "./lib/useRemoteDir";

export function SftpView({ now, home }: { now: number; home: string | null }) {
  const [focusedSide, setFocusedSide] = useState<SftpSide>("local");

  const local = useLocalDir(home);
  const remote = useRemoteDir();

  const { hosts, init } = useSshHostsStore();
  useEffect(() => {
    void init();
  }, [init]);

  const handleHostSelect = useCallback(
    (hostId: string) => {
      const host = hosts.find((h) => h.id === hostId);
      if (host) void remote.connect(host);
    },
    [hosts, remote.connect],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-card px-2">
        <span className="text-xs font-medium text-foreground/80">SFTP</span>
        <SftpHostPicker hosts={hosts} onSelect={handleHostSelect} />
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="sftp-local" defaultSize="50%" minSize="20%">
          <SftpPane
            side="local"
            title="Local"
            path={local.path}
            entries={local.entries}
            now={now}
            connected
            focused={focusedSide === "local"}
            onFocus={() => setFocusedSide("local")}
            status={local.status}
            error={local.error}
            onNavigate={local.navigate}
            onEnterDir={local.enterDir}
            onBack={local.goBack}
            onForward={local.goForward}
            onUp={local.goUp}
            onHome={local.goHome}
            onRefresh={local.refresh}
            canGoBack={local.canGoBack}
            canGoForward={local.canGoForward}
            showHidden={local.showHidden}
            onToggleHidden={local.toggleHidden}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="sftp-remote" defaultSize="50%" minSize="20%">
          <SftpPane
            side="remote"
            title={remote.hostName ?? "Remote"}
            path={remote.path}
            entries={remote.entries}
            now={now}
            connected={remote.connected}
            focused={focusedSide === "remote"}
            onFocus={() => setFocusedSide("remote")}
            status={remote.status}
            error={remote.error}
            onNavigate={remote.navigate}
            onEnterDir={remote.enterDir}
            onBack={remote.goBack}
            onForward={remote.goForward}
            onUp={remote.goUp}
            onHome={remote.goHome}
            onRefresh={remote.refresh}
            canGoBack={remote.canGoBack}
            canGoForward={remote.canGoForward}
            showHidden={remote.showHidden}
            onToggleHidden={remote.toggleHidden}
          />
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
