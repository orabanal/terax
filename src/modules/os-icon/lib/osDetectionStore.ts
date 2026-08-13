import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeDistroId, parseOsReleaseId } from "./osIcons";

type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

// One silent probe per SSH connection: /etc/os-release for Linux distros,
// uname -s as fallback for macOS/BSD targets. Mirrors Netcatty's probe but
// reuses the existing ssh_exec channel instead of a new connection.
const OS_PROBE_COMMAND =
  'cat /etc/os-release 2>/dev/null || uname -s 2>/dev/null || true';

const PROBE_TIMEOUT_MS = 7_000;

/** hostId -> detected distro id ("" while unknown). */
const detectedByHost = new Map<string, string>();
/** ssh session id -> hostId currently probing (dedupes StrictMode/remounts). */
const probingSessions = new Set<number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function detectedDistroForHost(hostId: string): string {
  return detectedByHost.get(hostId) ?? "";
}

export function useDetectedDistro(hostId: string | undefined): string {
  return useSyncExternalStore(subscribe, () =>
    hostId ? detectedByHost.get(hostId) ?? "" : "",
  );
}

/**
 * Probe the remote OS once per SSH session. Safe to call on every render:
 * dedupes per session id and caches the result per host id.
 */
export function probeRemoteOs(hostId: string, sshSessionId: number): void {
  if (detectedByHost.has(hostId)) return;
  if (probingSessions.has(sshSessionId)) return;
  probingSessions.add(sshSessionId);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS),
  );

  void Promise.race([
    invoke<SshExecResult>("ssh_exec", {
      id: sshSessionId,
      command: OS_PROBE_COMMAND,
    }),
    timeout,
  ])
    .then((res) => {
      const raw = `${res.stdout}\n${res.stderr}`.trim();
      if (!raw) return;
      const distro = normalizeDistroId(parseOsReleaseId(raw));
      if (distro) {
        detectedByHost.set(hostId, distro);
        emit();
      }
    })
    .catch(() => {
      // Probe failed (timeout, exec rejected, non-POSIX target): keep the
      // generic server icon. Do not cache the failure so a reconnect retries.
    })
    .finally(() => {
      probingSessions.delete(sshSessionId);
    });
}

/** Drop the cached detection (e.g. host entry deleted). */
export function clearDetectedDistro(hostId: string): void {
  if (detectedByHost.delete(hostId)) emit();
}
