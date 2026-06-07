import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useState } from "react";
import { SftpConflictDialog } from "./components/SftpConflictDialog";
import { SftpDeleteDialog } from "./components/SftpDeleteDialog";
import { SftpHostPicker } from "./components/SftpHostPicker";
import { SftpNameDialog } from "./components/SftpNameDialog";
import { SftpPane } from "./components/SftpPane";
import { SftpPermissionsDialog } from "./components/SftpPermissionsDialog";
import { SftpTransferQueue } from "./components/SftpTransferQueue";
import {
  MOCK_HOSTS,
  MOCK_REMOTE_ENTRIES,
  MOCK_REMOTE_PATH,
  MOCK_TRANSFERS,
} from "./lib/mockData";
import type { SftpSide } from "./lib/types";
import { useLocalDir } from "./lib/useLocalDir";

/**
 * Milestone 2: the LOCAL pane navigates the real filesystem via `fs_read_dir`
 * (listing, enter/up/back/forward/home/refresh, breadcrumb, filter). The REMOTE
 * pane is still backed by static mock data until the SFTP backend lands.
 */
export function SftpView({ now, home }: { now: number; home: string | null }) {
  const [focusedSide, setFocusedSide] = useState<SftpSide>("local");
  // Remote starts "connected" so the populated pane is visible for review; the
  // empty-state is reachable by toggling this once interactivity lands.
  const [remoteConnected] = useState(true);

  const local = useLocalDir(home);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-card px-2">
        <span className="text-xs font-medium text-foreground/80">SFTP</span>
        <SftpHostPicker hosts={MOCK_HOSTS} />
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
            title={remoteConnected ? MOCK_HOSTS[0].name : "Remote"}
            path={MOCK_REMOTE_PATH}
            entries={MOCK_REMOTE_ENTRIES}
            now={now}
            connected={remoteConnected}
            focused={focusedSide === "remote"}
            onFocus={() => setFocusedSide("remote")}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <SftpTransferQueue transfers={MOCK_TRANSFERS} />

      <SftpDialogs now={now} />
    </div>
  );
}

/** Dialogs are mounted closed; Milestone 1 keeps them inert but present so the
 *  set of modal surfaces is visible in the tree and reviewable. */
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
