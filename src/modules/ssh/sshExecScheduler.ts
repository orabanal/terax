import { invoke } from "@tauri-apps/api/core";

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

/**
 * Single scheduler for background `ssh_exec` probes per SSH session (A5).
 *
 * Before: git chip (2 execs/cycle), server stats (1 heavy exec/cycle) and
 * friends fired independently — during agent streaming every burst could
 * stack several exec channels against an already-busy server. Now periodic
 * polls serialize per sshId with a minimum gap, so the worst case is one
 * exec at a time, paced. Explicit user actions (diff panel, source control)
 * bypass the scheduler and stay direct.
 */
const MIN_GAP_MS = 250;

const chains = new Map<number, Promise<unknown>>();
const lastRun = new Map<number, number>();

export function scheduleSshExec(
  sshId: number,
  command: string,
): Promise<SshExecResult> {
  const prev = chains.get(sshId) ?? Promise.resolve();
  const run: Promise<SshExecResult> = prev.catch(() => {}).then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - (lastRun.get(sshId) ?? 0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await invoke<SshExecResult>("ssh_exec", {
      id: sshId,
      command,
    });
    lastRun.set(sshId, Date.now());
    return res;
  });
  chains.set(sshId, run);
  // Don't leave settled chains pinning dead sessions: drop ours if nothing
  // newer chained behind it. (A newer chain keeps working — it captured
  // `prev` before we delete.)
  void run
    .catch(() => {})
    .finally(() => {
      if (chains.get(sshId) === run) chains.delete(sshId);
    });
  return run;
}

/** For tests: how many sessions currently hold a chain. */
export function schedulerChainCount(): number {
  return chains.size;
}
