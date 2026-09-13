import { useEffect, useReducer } from "react";
import { cn } from "@/lib/utils";
import { localOsId, OsIcon, useDetectedDistro } from "@/modules/os-icon";
import type { SshHost } from "@/modules/ssh/store";
import {
  ComputerTerminal02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getLeafSessionConfig,
  isSessionConnected,
  isSshDisconnected,
  subscribeSshStatus,
} from "./lib/useTerminalSession";

export type PaneConnectionStatus = "up" | "starting" | "down";

export type PaneConnection =
  | {
      kind: "ssh";
      name: string;
      hostId: string;
      status: PaneConnectionStatus;
    }
  | { kind: "local"; status: PaneConnectionStatus };

type ConnectionReader = {
  config: (
    leafId: number,
  ) => { sshHost?: Pick<SshHost, "id" | "name"> | undefined } | null;
  connected: (leafId: number) => boolean;
  sshDisconnected: (leafId: number) => boolean;
};

/** Pure identity + status resolution (readers injectable for tests). */
export function describePaneConnection(
  leafId: number,
  read: ConnectionReader,
): PaneConnection {
  const cfg = read.config(leafId);
  if (cfg?.sshHost) {
    const status: PaneConnectionStatus = read.sshDisconnected(leafId)
      ? "down"
      : read.connected(leafId)
        ? "up"
        : "starting";
    return {
      kind: "ssh",
      name: cfg.sshHost.name || cfg.sshHost.id,
      hostId: cfg.sshHost.id,
      status,
    };
  }
  return {
    kind: "local",
    status: read.connected(leafId) ? "up" : "starting",
  };
}

const liveReaders: ConnectionReader = {
  config: getLeafSessionConfig,
  connected: isSessionConnected,
  sshDisconnected: isSshDisconnected,
};

const DOT: Record<PaneConnectionStatus, string> = {
  up: "bg-emerald-500",
  starting: "bg-amber-500",
  down: "bg-red-500",
};

const STATUS_LABEL: Record<PaneConnectionStatus, string> = {
  up: "connected",
  starting: "connecting",
  down: "disconnected",
};

/** Floating per-pane connection badge (multi-pane tabs only). Read-only and
 *  pointer-transparent so terminal mouse/selection keep working underneath. */
export function PaneConnectionChip({ leafId }: { leafId: number }) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeSshStatus(leafId, () => bump()), [leafId]);
  const conn = describePaneConnection(leafId, liveReaders);

  return (
    <div
      className="pointer-events-none absolute top-1.5 right-1.5 z-20 flex max-w-[45%] items-center gap-1 truncate rounded bg-background/80 py-0.5 pr-1.5 pl-1 text-[10px] text-muted-foreground opacity-80 ring-1 ring-border/40 backdrop-blur-sm"
      role="status"
      aria-label={`Connection: ${conn.kind === "ssh" ? conn.name : "Local"}, ${STATUS_LABEL[conn.status]}`}
    >
      {conn.kind === "ssh" ? (
        <SshPaneIcon hostId={conn.hostId} />
      ) : (
        <LocalPaneIcon />
      )}
      <span className="truncate">
        {conn.kind === "ssh" ? conn.name : "Local"}
      </span>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[conn.status])} />
    </div>
  );
}

function SshPaneIcon({ hostId }: { hostId: string }) {
  const detected = useDetectedDistro(hostId);
  if (detected) return <OsIcon distroId={detected} />;
  return (
    <HugeiconsIcon
      icon={ServerStack01Icon}
      size={11}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}

function LocalPaneIcon() {
  const osId = localOsId();
  if (osId) return <OsIcon distroId={osId} />;
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={11}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}
