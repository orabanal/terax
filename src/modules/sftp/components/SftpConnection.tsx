import { useEffect, useRef } from "react";
import type { SshHost } from "@/modules/ssh/store";
import { useLocalDir } from "../lib/useLocalDir";
import { useRemoteDir } from "../lib/useRemoteDir";
import { useSftpEdit } from "../lib/useSftpEdit";
import type { TransferQueue } from "../lib/useTransferQueue";
import { SftpPane, type SftpPaneMode } from "./SftpPane";
import type { SftpConnStatus } from "./SftpSubTabs";

type Props = {
  connKey: string;
  /** Stable bookmark scope for this connection (see bookmarkKeyFor). */
  bookmarkKey: string;
  mode: SftpPaneMode;
  home: string | null;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  now: number;
  connectToHost?: SshHost | null;
  onOpenFile?: (path: string) => void;
  /** Bumped by SftpView after any transfer completes, to refresh this pane. */
  refreshTick?: number;
  enqueueRemoteEditUpload: TransferQueue["enqueueRemoteEditUpload"];
  enqueueDuplicate: TransferQueue["enqueueDuplicate"];
  /** Reports connection state up so the sub-tab bar can show a live dot. */
  onStatusChange?: (connKey: string, status: SftpConnStatus) => void;
};

export function SftpConnection({
  connKey,
  bookmarkKey,
  mode,
  home,
  visible,
  focused,
  onFocus,
  now,
  connectToHost,
  onOpenFile,
  refreshTick,
  enqueueRemoteEditUpload,
  enqueueDuplicate,
  onStatusChange,
}: Props) {
  const local = useLocalDir(home);
  const remote = useRemoteDir();
  const data = mode === "local" ? local : remote;
  const { editRemoteFile, openRemoteFile, openRemoteFileWith } = useSftpEdit(
    onOpenFile ?? (() => {}),
    data.refresh,
    enqueueRemoteEditUpload,
  );
  const autoConnectDone = useRef(false);
  const connected = mode === "local" || remote.connected;
  const title = mode === "local" ? "Local" : (remote.hostName ?? "Remote");

  useEffect(() => {
    if (connectToHost && mode === "remote" && !autoConnectDone.current) {
      autoConnectDone.current = true;
      void remote.connect(connectToHost);
    }
  }, [connectToHost, mode, remote]);

  useEffect(() => {
    onStatusChange?.(connKey, data.status);
  }, [connKey, data.status, onStatusChange]);

  // Refresh after a transfer completes elsewhere. Skip the initial mount
  // (refreshTick starts at 0) so we don't double-load on first render.
  const lastTick = useRef(refreshTick);
  useEffect(() => {
    if (refreshTick === lastTick.current) return;
    lastTick.current = refreshTick;
    if (visible) void data.refresh();
  }, [refreshTick, visible, data]);

  if (!visible) return null;

  return (
    <SftpPane
      connKey={connKey}
      bookmarkKey={bookmarkKey}
      side={mode === "local" ? "local" : "remote"}
      title={title}
      path={data.path}
      entries={data.entries}
      now={now}
      connected={connected}
      focused={focused}
      onFocus={onFocus}
      status={data.status}
      error={data.error}
      onNavigate={data.navigate}
      onEnterDir={data.enterDir}
      onBack={data.goBack}
      onForward={data.goForward}
      onUp={data.goUp}
      onHome={data.goHome}
      onRefresh={data.refresh}
      onReconnect={mode === "remote" ? remote.reconnect : undefined}
      canGoBack={data.canGoBack}
      canGoForward={data.canGoForward}
      showHidden={data.showHidden}
      onToggleHidden={data.toggleHidden}
      mode={mode}
      mkdir={data.mkdir}
      createFile={data.createFile}
      rename={data.rename}
      remove={data.remove}
      chmod={data.chmod}
      sessionId={mode === "remote" ? remote.sessionId : null}
      editRemoteFile={editRemoteFile}
      openRemoteFile={openRemoteFile}
      openRemoteFileWith={openRemoteFileWith}
      onOpenFile={onOpenFile}
      onDuplicate={enqueueDuplicate}
    />
  );
}
