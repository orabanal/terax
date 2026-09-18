import { useEffect, useReducer, useRef } from "react";
import type { SshHost } from "@/modules/ssh/store";
import {
  getLeafSessionConfig,
  isSessionConnected,
  isSshDisconnected,
  subscribeSshStatus,
} from "./useTerminalSession";

export type PaneConnectionStatus = "up" | "starting" | "down";

export type PaneConnection =
  | {
      kind: "ssh";
      name: string;
      hostId: string;
      status: PaneConnectionStatus;
    }
  | { kind: "local"; status: PaneConnectionStatus };

export const CONNECTION_DOT: Record<PaneConnectionStatus, string> = {
  up: "bg-emerald-500",
  starting: "bg-amber-500",
  down: "bg-red-500",
};

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

/** Stable identity+status string for change detection (readers injectable). */
export function paneConnectionSignature(conn: PaneConnection): string {
  return conn.kind === "ssh"
    ? `ssh:${conn.hostId}:${conn.status}`
    : `local:${conn.status}`;
}

const liveReaders: ConnectionReader = {
  config: getLeafSessionConfig,
  connected: isSessionConnected,
  sshDisconnected: isSshDisconnected,
};

/** Live per-leaf connection, re-rendering only when the resolved
 *  identity+status actually changes: SSH status events plus SSH traffic
 *  ("terax:ssh-activity") cover connects that emit no status, and a
 *  post-mount reconcile catches a session record the first render missed. */
export function usePaneConnection(leafId: number): PaneConnection {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const conn = describePaneConnection(leafId, liveReaders);
  const renderedSig = useRef("");
  renderedSig.current = paneConnectionSignature(conn);
  useEffect(() => {
    let last = renderedSig.current;
    const check = () => {
      const next = paneConnectionSignature(
        describePaneConnection(leafId, liveReaders),
      );
      if (next !== last) {
        last = next;
        bump();
      }
    };
    const unsub = subscribeSshStatus(leafId, check);
    const onActivity = (e: Event) => {
      if ((e as CustomEvent<{ leafId: number }>).detail?.leafId === leafId) {
        check();
      }
    };
    window.addEventListener("terax:ssh-activity", onActivity);
    check();
    return () => {
      unsub();
      window.removeEventListener("terax:ssh-activity", onActivity);
    };
  }, [leafId]);
  return conn;
}
