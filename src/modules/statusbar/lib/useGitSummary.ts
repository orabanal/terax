import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";

export type GitQuickSummary = {
  repoRoot: string;
  branch: string;
  files: number;
  added: number;
  removed: number;
};

export type GitSummaryState = {
  summary: GitQuickSummary | null;
  sshCwd: string | null;
};

const POLL_MS = 15_000;
const SSH_TIMEOUT_MS = 7_000;

type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

// Detect the CWD of the interactive PTY shell via its sibling process (Linux /proc).
// Primary: ps --ppid $PPID (newer OpenSSH where PTY shell and exec channel share parent).
// Fallback: ps -e with ppid match (older OpenSSH / CentOS 7 that forks separate sshd per channel).
// If /proc is unavailable (non-Linux target) the cd is silently skipped and git may not find a repo.
// CWD is emitted as a separate line so the caller can cache it for subsequent diff fetches.
const SSH_GIT_SCRIPT = [
  '_p=$(ps --ppid $PPID -o pid=,comm= 2>/dev/null | awk -v self=$$ \'$1!=self && $2~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}\')',
  '[ -z "$_p" ] && _p=$(ps -e -o pid=,ppid=,comm= 2>/dev/null | awk -v pp=$PPID -v self=$$ \'$1!=self && $2==pp && $3~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}\')',
  '[ -n "$_p" ] && { _d=$(readlink /proc/$_p/cwd 2>/dev/null); [ -n "$_d" ] && cd "$_d" 2>/dev/null; }',
  'branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || true',
  '[ -z "$branch" ] && exit 0',
  'shortstat=$(git diff --shortstat HEAD 2>/dev/null) || true',
  "printf 'CWD:%s\\nBRANCH:%s\\nSTAT:%s\\n' \"${_d:-}\" \"$branch\" \"$shortstat\"",
].join('; ');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

function parseShortstatNum(s: string, keyword: string): number {
  const match = new RegExp(`(\\d+)\\s+${keyword}`).exec(s);
  return match ? parseInt(match[1], 10) : 0;
}

async function fetchLocalSummary(cwd: string): Promise<GitQuickSummary | null> {
  return invoke<GitQuickSummary | null>("git_quick_summary", {
    cwd,
    workspace: currentWorkspaceEnv(),
  });
}

async function fetchSshSummary(sshId: number): Promise<{ summary: GitQuickSummary | null; sshCwd: string | null }> {
  const result = await withTimeout(
    invoke<SshExecResult>("ssh_exec", { id: sshId, command: SSH_GIT_SCRIPT }),
    SSH_TIMEOUT_MS,
  );

  const cwdMatch = /^CWD:(.*)$/m.exec(result.stdout);
  const branchMatch = /^BRANCH:(.+)$/m.exec(result.stdout);
  const statMatch = /^STAT:(.*)$/m.exec(result.stdout);
  const branch = branchMatch?.[1]?.trim();
  const detectedCwd = cwdMatch?.[1]?.trim() || null;

  if (!branch) return { summary: null, sshCwd: detectedCwd };

  const shortstat = statMatch?.[1]?.trim() ?? "";
  return {
    summary: {
      repoRoot: "",
      branch,
      files: parseShortstatNum(shortstat, "file"),
      added: parseShortstatNum(shortstat, "insertion"),
      removed: parseShortstatNum(shortstat, "deletion"),
    },
    sshCwd: detectedCwd,
  };
}

export function useGitSummary(
  cwd: string | null,
  leafId: number | null,
  isSSH: boolean,
): GitSummaryState {
  const [summary, setSummary] = useState<GitQuickSummary | null>(null);
  const [sshCwd, setSshCwd] = useState<string | null>(null);
  const liveRef = useRef(true);

  const fetch = useCallback(async () => {
    try {
      let result: GitQuickSummary | null = null;
      let detectedCwd: string | null = null;
      if (isSSH && leafId !== null) {
        // SSH: CWD is detected remotely from the PTY shell's /proc entry.
        // Do not rely on `cwd` from OSC 7 -- it may be null if the remote
        // shell doesn't emit OSC 7, and exec channels start in HOME anyway.
        const sshId = ptyIdForLeaf(leafId);
        if (sshId !== null) {
          const fetched = await fetchSshSummary(sshId);
          result = fetched.summary;
          detectedCwd = fetched.sshCwd;
        }
      } else if (!isSSH && cwd) {
        result = await fetchLocalSummary(cwd);
      }
      if (liveRef.current) {
        setSummary(result);
        setSshCwd(detectedCwd);
      }
    } catch {
      if (liveRef.current) {
        setSummary(null);
        setSshCwd(null);
      }
    }
  }, [cwd, leafId, isSSH]);

  useEffect(() => {
    liveRef.current = true;
    void fetch();
    const id = setInterval(() => void fetch(), POLL_MS);
    return () => {
      liveRef.current = false;
      clearInterval(id);
    };
  }, [fetch]);

  return { summary, sshCwd };
}
