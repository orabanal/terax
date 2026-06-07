import { useEffect, useRef } from "react";
import type { SshHost } from "@/modules/ssh/store";
import { useLocalDir } from "../lib/useLocalDir";
import { useRemoteDir } from "../lib/useRemoteDir";
import { useSftpEdit } from "../lib/useSftpEdit";
import { SftpPane, type SftpPaneMode } from "./SftpPane";

type Props = {
  connKey: string;
  mode: SftpPaneMode;
  home: string | null;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  now: number;
  hosts: SshHost[];
  onHostSelect: (host: SshHost) => void;
  onLocal: () => void;
  connectToHost?: SshHost | null;
  onOpenFile?: (path: string) => void;
};

export function SftpConnection({
  connKey,
  mode,
  home,
  visible,
  focused,
  onFocus,
  now,
  hosts,
  onHostSelect,
  onLocal,
  connectToHost,
  onOpenFile,
}: Props) {
  const local = useLocalDir(home);
  const remote = useRemoteDir();
  const data = mode === "local" ? local : remote;
  const { editRemoteFile, openRemoteFile } = useSftpEdit(
    onOpenFile ?? (() => {}),
    data.refresh,
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

  if (!visible) return null;

  return (
    <SftpPane
      connKey={connKey}
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
      canGoBack={data.canGoBack}
      canGoForward={data.canGoForward}
      showHidden={data.showHidden}
      onToggleHidden={data.toggleHidden}
      mode={mode}
      hosts={hosts}
      onHostSelect={onHostSelect}
      onLocal={onLocal}
      mkdir={data.mkdir}
      createFile={data.createFile}
      rename={data.rename}
      remove={data.remove}
      chmod={data.chmod}
      sessionId={mode === "remote" ? remote.sessionId : null}
      editRemoteFile={editRemoteFile}
      openRemoteFile={openRemoteFile}
    />
  );
}
