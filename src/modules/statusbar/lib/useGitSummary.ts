import { invoke } from "@tauri-apps/api/core";
import { scheduleSshExec } from "@/modules/ssh/sshExecScheduler";
import {
  ensureGitWatcher,
  gitWatcherFirstEventAt,
  stopGitWatcher,
  type GitWatchEvent,
} from "./gitWatcher";
import { useCallback, useEffect, useRef, useState } from "react";
import { nextPollInterval } from "@/lib/pollBackoff";
import { useWindowActive } from "@/lib/useWindowActive";
import { useAgentStore } from "@/modules/agents/store/agentStore";
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
  loading: boolean;
  /** Forced refresh (bypasses gates) — wired to the status chip click. */
  refresh: () => void;
};

const POLL_MS = 15_000;
const SSH_TIMEOUT_MS = 7_000;
const SSH_ACTIVITY_DEBOUNCE_MS = 800;
// #1 — quiescence gate: while the PTY recently produced output (agent
// streaming, installs, ...), skip the remote `git diff` probe so it doesn't
// steal server CPU/IO from the process being watched. Refresh once output
// goes quiet, or at the latest after MAX_STALE so the chip never freezes.
const SSH_QUIET_MS = 4_000;
const SSH_MAX_STALE_MS = 60_000;
const SSH_QUIET_RETRY_MS = 4_500;
// One-shot retry after a failed probe. Without it, a failure right after
// the stream ends strands the chip until the next poll (now backed off),
// which reads as "never updates". Single-timer guarded like the quiet
// retry, so dead servers cost one cheap failing exec per ~10s, not a storm.
const FAILURE_RETRY_MS = 10_000;

export type RemoteFetchTiming = {
  now: number;
  lastActivityAt: number;
  lastFetchAt: number;
  quietMs: number;
  maxStaleMs: number;
};

/** True when a remote probe should be deferred: recent output, and the last
 *  successful probe isn't stale enough to force one through. */
export function shouldDeferRemoteFetch(t: RemoteFetchTiming): boolean {
  if (t.now - t.lastActivityAt >= t.quietMs) return false;
  return t.now - t.lastFetchAt < t.maxStaleMs;
}

// While the agent holds the leaf in `working`, probes slow down to a 30s
// backup cadence instead of stopping entirely.
const AGENT_BUSY_MAX_STALE_MS = 30_000;

// Stage-1 (CWD+branch) runs at most this often while output streams. The
// interactive shell is busy then, so its cwd cannot change — re-probing
// every burst would be pure fork+exec overhead competing with the agent.
export const SSH_STAGE1_BACKOFF_MS = 30_000;

export type SshFetchDecision = "fetch" | "defer" | "skip";

/** Combined gate for the SSH probe:
 * - agent `working` + fresh probe → "skip" (the poll loop retries on
 *   its own; scheduling retries here would pile timers during long runs).
 * - agent `working` + stale probe → "fetch" (slow 30s backup poll).
 * - `cwdChanged` (the human moved) upgrades "defer" → "fetch": the
 *   branch almost certainly changed, no reason to wait out the quiet
 *   window. Never overrides the `working` skip.
 * - otherwise → quiescence rule: "defer" (retry on quiet) or "fetch".
 *   The quiescence fallback also covers agents the store never marks as
 *   `working` (e.g. opencode signals land as `waiting` with no finish). */
export function gateSshFetch(args: {
  now: number;
  agentBusy: boolean;
  lastActivityAt: number;
  lastFetchAt: number;
  cwdChanged?: boolean;
}): SshFetchDecision {
  if (args.agentBusy) {
    return args.now - args.lastFetchAt < AGENT_BUSY_MAX_STALE_MS
      ? "skip"
      : "fetch";
  }
  const defer = shouldDeferRemoteFetch({
    now: args.now,
    lastActivityAt: args.lastActivityAt,
    lastFetchAt: args.lastFetchAt,
    quietMs: SSH_QUIET_MS,
    maxStaleMs: SSH_MAX_STALE_MS,
  });
  if (defer && args.cwdChanged) return "fetch";
  return defer ? "defer" : "fetch";
}

// Detect the CWD of the interactive PTY shell via its sibling process (Linux /proc).
// Primary: ps --ppid $PPID (newer OpenSSH where PTY shell and exec channel share parent).
// Fallback: ps -e with ppid match (older OpenSSH / CentOS 7 that forks separate sshd per channel).
// If /proc is unavailable (non-Linux target) the cd is silently skipped and git may not find a repo.
// CWD is emitted as a separate line so the caller can cache it for subsequent diff fetches.
// Shared shell-sibling CWD detection (see below). Kept as a prelude so the
// fast branch probe and the slow diff probe can't drift apart.
const SSH_CD_PRELUDE = [
  '_p=$(ps --ppid $PPID -o pid=,comm= 2>/dev/null | awk -v self=$$ \'$1!=self && $2~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}\')',
  '[ -z "$_p" ] && _p=$(ps -e -o pid=,ppid=,comm= 2>/dev/null | awk -v pp=$PPID -v self=$$ \'$1!=self && $2==pp && $3~/^(ba|z|fi|k|da)?sh$/{pid=$1}END{print pid}\')',
  '[ -n "$_p" ] && { _d=$(readlink /proc/$_p/cwd 2>/dev/null); [ -n "$_d" ] && cd "$_d" 2>/dev/null; }',
];

const SSH_BRANCH_LINE =
  'branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || true';

// STAGE 1 — fast: CWD + branch, no diff (~3 cheap commands). Always runs
// (window-active), so the chip appears like the local tab does.
const SSH_CWD_BRANCH_SCRIPT = [
  ...SSH_CD_PRELUDE,
  SSH_BRANCH_LINE,
  "printf 'CWD:%s\\nBRANCH:%s\\n' \"${_d:-}\" \"$branch\"",
].join('; ');

// STAGE 2 — slow: the shortstat diff. Gated (working / quiescence / forced).
// (Kept as the fallback path when the git watcher can't run; the primary
// path is event-driven and needs no probes at all.)
const SSH_DIFF_SCRIPT = [
  ...SSH_CD_PRELUDE,
  SSH_BRANCH_LINE,
  'shortstat=$(git diff --shortstat HEAD 2>/dev/null) || true',
  "printf 'BRANCH:%s\\nSTAT:%s\\n' \"$branch\" \"$shortstat\"",
].join('; ');

// One-shot merged probe: CWD + branch + shortstat in a single exec. Used
// for manual refresh (always does something visible) — never on a timer.
const MERGED_SSH_GIT_SCRIPT = [
  ...SSH_CD_PRELUDE,
  SSH_BRANCH_LINE,
  'shortstat=$(git diff --shortstat HEAD 2>/dev/null) || true',
  "printf 'CWD:%s\\nBRANCH:%s\\nSTAT:%s\\n' \"${_d:-}\" \"$branch\" \"$shortstat\"",
].join('; ');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  // A3: the loser of the race must not leave its timer armed — a hung
  // server would otherwise pile one live timer per abandoned probe.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

/** Extract the remote CWD from a probe payload. Null when undetectable. */
export function parseSshCwd(stdout: string): string | null {
  const m = /^CWD:(.*)$/m.exec(stdout);
  const dir = m?.[1]?.trim();
  return dir ? dir : null;
}

/** Extract the remote branch from a probe payload. Null when undetectable
 *  (including genuinely not-a-repo). */
export function parseSshBranch(stdout: string): string | null {
  const m = /^BRANCH:(.+)$/m.exec(stdout);
  const branch = m?.[1]?.trim();
  return branch ? branch : null;
}

async function fetchSshCwdBranch(
  sshId: number,
): Promise<{ cwd: string | null; branch: string | null }> {
  const result = await withTimeout(
    scheduleSshExec(sshId, SSH_CWD_BRANCH_SCRIPT),
    SSH_TIMEOUT_MS,
  );
  return {
    cwd: parseSshCwd(result.stdout),
    branch: parseSshBranch(result.stdout),
  };
}

export type SshDiff = {
  branch: string;
  files: number;
  added: number;
  removed: number;
};

async function fetchSshDiff(sshId: number): Promise<SshDiff | null> {
  const result = await withTimeout(
    scheduleSshExec(sshId, SSH_DIFF_SCRIPT),
    SSH_TIMEOUT_MS,
  );
  const branch = parseSshBranch(result.stdout);
  if (!branch) return null;
  const statMatch = /^STAT:(.*)$/m.exec(result.stdout);
  const shortstat = statMatch?.[1]?.trim() ?? "";
  return {
    branch,
    files: parseShortstatNum(shortstat, "file"),
    added: parseShortstatNum(shortstat, "insertion"),
    removed: parseShortstatNum(shortstat, "deletion"),
  };
}

/** Merge a freshly probed branch into the displayed summary: keep live
 *  counts when the branch is unchanged (no clean-dot flash on every poll),
 *  start from zeros on a real move, hide when there is no branch. */
export function mergeBranchSummary(
  prev: GitQuickSummary | null | undefined,
  branch: string | null,
): GitQuickSummary | null {
  if (!branch) return null;
  if (prev && prev.branch === branch) return prev;
  return { repoRoot: "", branch, files: 0, added: 0, removed: 0 };
}

/** Merge diff counts into the displayed summary, but only when they belong
 *  to the branch on screen (a `cd` mid-flight must not paint the old
 *  repo's numbers onto the new one). */
export function applyDiffCounts(
  prev: GitQuickSummary | null,
  diff: SshDiff | null,
): GitQuickSummary | null {
  if (!diff || !prev || prev.branch !== diff.branch) return prev;
  return { ...prev, files: diff.files, added: diff.added, removed: diff.removed };
}

export function useGitSummary(
  cwd: string | null,
  leafId: number | null,
  isSSH: boolean,
): GitSummaryState {
  const [summary, setSummary] = useState<GitQuickSummary | null>(null);
  const [sshCwd, setSshCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const liveRef = useRef(true);
  // Generation of the current identity (cwd/leafId/isSSH). Guards against a
  // slow fetch from a previous identity overwriting the fresh one.
  const genRef = useRef(0);
  // Whether the current identity has settled at least once. Background
  // refreshes are silent: `loading` is only true for the initial fetch, and
  // failures keep the last-known summary (stale-while-revalidate) instead of
  // blanking the chip.
  const settledRef = useRef(false);

  // #3 — unfocused window: no probes at all (stale-while-hidden). Ref
  // mirrors so focus flips don't recreate `fetch` and reset the poll loop.
  const windowActive = useWindowActive();
  const windowActiveRef = useRef(windowActive);
  windowActiveRef.current = windowActive;
  // #1 — quiescence bookkeeping for the SSH path.
  const lastActivityRef = useRef(0);
  const lastFetchRef = useRef(0);
  const lastStage1Ref = useRef(0);
  const lastCwdRef = useRef<string | null>(null);
  // Timing/quiescence state belongs to one leaf connection; reset when the
  // leaf (or SSH-ness) changes, but NOT on OSC-cwd drift within the same
  // leaf — that drift is exactly what the cd-change bypass below detects.
  const timingKeyRef = useRef<string | null>(null);
  // A probe already running (slow server): background triggers back off so
  // concurrent `git diff`s don't pile onto a busy server. 0 = idle.
  const inflightRef = useRef(0);
  // Last-known display per leaf: switching back to a tab shows its own
  // repo data instantly instead of a blank chip while the forced refresh
  // lands. Keyed by leaf so another tab's repo is never shown.
  const cacheRef = useRef(
    new Map<number, { summary: GitQuickSummary | null; sshCwd: string | null }>(),
  );
  const quietRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M2: failure retries get their own slot. Sharing one timer meant a
  // defer-retry blocked a failure-retry (chip stranded) and vice versa.
  const failureRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session still connecting (no sshId yet): retry fast instead of waiting
  // out the 15s poll tick — otherwise first paint lands ~15s after open on
  // an idle shell that emits no activity events.
  const connectRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptsRef = useRef(0);
  const CONNECT_RETRY_MS = 1_000;
  const CONNECT_RETRY_MAX = 10;
  const fetchRef = useRef<(gen: number, force?: boolean) => Promise<void>>(
    async () => {},
  );

  const scheduleOnRef = useCallback(
    (
      slot: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
      gen: number,
      delayMs: number,
    ) => {
      if (slot.current !== null) return;
      slot.current = setTimeout(() => {
        slot.current = null;
        if (!liveRef.current || gen !== genRef.current) return;
        void fetchRef.current(gen);
      }, delayMs);
    },
    [],
  );
  const scheduleQuietRetry = useCallback(
    (gen: number) => scheduleOnRef(quietRetryRef, gen, SSH_QUIET_RETRY_MS),
    [scheduleOnRef],
  );
  const scheduleFailureRetry = useCallback(
    (gen: number) => scheduleOnRef(failureRetryRef, gen, FAILURE_RETRY_MS),
    [scheduleOnRef],
  );

  // Event-driven SSH path: applies a daemon emission (or a manual one-shot)
  // with the same merge semantics the polled stages used — no clean-dot
  // flash on unchanged branch, stale-branch counts never painted.
  const applyRemoteGit = useCallback(
    (
      cwd: string | null,
      branch: string | null,
      shortstat: string,
      forLeaf: number,
    ) => {
      if (cwd !== null) {
        lastCwdRef.current = cwd;
        setSshCwd(cwd);
      }
      const diff = branch
        ? {
            branch,
            files: parseShortstatNum(shortstat, "file"),
            added: parseShortstatNum(shortstat, "insertion"),
            removed: parseShortstatNum(shortstat, "deletion"),
          }
        : null;
      const merge = (prev: GitQuickSummary | null) =>
        applyDiffCounts(mergeBranchSummary(prev, branch), diff);
      setSummary(merge);
      const prevCache = cacheRef.current.get(forLeaf);
      cacheRef.current.set(forLeaf, {
        summary: merge(prevCache?.summary ?? null),
        sshCwd: cwd ?? prevCache?.sshCwd ?? null,
      });
      lastFetchRef.current = Date.now();
      settledRef.current = true;
      setLoading(false);
    },
    [],
  );

  // Watcher bookkeeping: which sshId has a running daemon. Events arrive
  // via the `terax:git-event` subscription below; when the daemon can't
  // run (non-POSIX remote), watcherFailed pins this leaf to legacy polls.
  const watcherSshIdRef = useRef<number | null>(null);
  const watcherFailedRef = useRef(false);
  const watcherSinceRef = useRef(0);
  // No first event within this window after ensure means the pipe is
  // broken (bad tail, incompatible printf, ...) — fall back to polls
  // instead of a permanently blank chip. Past the first event, silence is
  // normal (nothing changed) and never triggers fallback.
  const WATCHER_FIRST_EVENT_MS = 15_000;

  const ensureWatcherForLeaf = useCallback(
    async (sshId: number, gen: number): Promise<boolean> => {
      if (watcherFailedRef.current) return false;
      if (watcherSshIdRef.current === sshId) return true;
      const prev = watcherSshIdRef.current;
      watcherSshIdRef.current = null;
      if (prev !== null) void stopGitWatcher(prev);
      const ok = await ensureGitWatcher(sshId);
      if (!liveRef.current || gen !== genRef.current) {
        if (ok) void stopGitWatcher(sshId);
        return false;
      }
      if (ok) {
        watcherSshIdRef.current = sshId;
        watcherSinceRef.current = Date.now();
      } else watcherFailedRef.current = true;
      return ok;
    },
    [],
  );

  // Agent-busy signal: skip the remote probe while this leaf's session is
  // `working` (Claude Code SSH marks exactly this span; the session is
  // removed on idle). Primitive selector → re-renders only on status flips
  // of this leaf. Mirrored to a ref so flips don't recreate `fetch` and
  // reset the poll loop via the identity effect below.
  const agentStatus = useAgentStore((s) =>
    leafId !== null ? (s.sessions[leafId]?.status ?? null) : null,
  );
  const agentBusyRef = useRef(false);
  agentBusyRef.current = agentStatus === "working";

  // Refresh once when the agent releases the leaf (working → waiting, or
  // session removed on idle). Forced: the user is looking at the result.
  // Skips the first run: identity effect fetches.
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const busy = agentStatus === "working";
    const was = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (was && !busy) void fetchRef.current(genRef.current, true);
  }, [agentStatus]);

  // `force` = explicit user attention (tab switch, refocus, agent done):
  // bypass the working/quiescence gates. Background triggers (15s poll,
  // activity debounce, quiet retry) always pass false. One forced exec is
  // negligible next to what the user just asked to see.
  const fetch = useCallback(async (gen: number, force = false) => {
    if (!liveRef.current || genRef.current !== gen) return;
    if (!windowActiveRef.current) return;
    // Slow probes under load overlap with the next triggers (15s poll,
    // debounces); without this, N concurrent `git diff`s pile onto an
    // already busy server. Forced fetches (user looking) still go through.
    if (!force && inflightRef.current !== 0) return;
    inflightRef.current = gen;
    try {
      if (!isSSH) {
        if (!cwd) return;
        if (!settledRef.current) setLoading(true);
        try {
          const result = await fetchLocalSummary(cwd);
          if (!liveRef.current || genRef.current !== gen) return;
          setSummary(result);
          if (leafId !== null) {
            cacheRef.current.set(leafId, { summary: result, sshCwd: null });
          }
        } catch {
          if (!liveRef.current || genRef.current !== gen) return;
          // Never blank on failure; first failure keeps initial nulls.
          // One retry so a transient blip right after activity ends
          // doesn't strand the chip until the next poll.
          scheduleFailureRetry(gen);
        }
        settledRef.current = true;
        setLoading(false);
        return;
      }
      // SSH from here. CWD is detected remotely from the PTY shell's
      // /proc entry — never rely on `cwd` from OSC 7, which remote shells
      // often don't emit (and exec channels start in HOME anyway).
      if (leafId === null) return;
      const sshId = ptyIdForLeaf(leafId);
      if (sshId === null) {
        // Session still connecting: retry in 1s (capped) so first paint
        // follows the connection instead of the 15s poll tick.
        if (connectAttemptsRef.current < CONNECT_RETRY_MAX) {
          connectAttemptsRef.current += 1;
          scheduleOnRef(connectRetryRef, gen, CONNECT_RETRY_MS);
        }
        return;
      }
      connectAttemptsRef.current = 0;
      if (!settledRef.current) setLoading(true);
      // Primary SSH path: event-driven daemon. No probes, no gates — the
      // daemon emits only on change, so there is nothing to throttle. The
      // stage 1/2 code below remains as the fallback for remotes where the
      // daemon cannot run.
      if (await ensureWatcherForLeaf(sshId, gen)) {
        if (!liveRef.current || genRef.current !== gen) return;
        // Silent pipe guard: daemon promised but never delivered (broken
        // tail, incompatible shell, ...) — drop it and poll this round
        // instead of blanking the chip forever.
        if (
          gitWatcherFirstEventAt(sshId) === null &&
          Date.now() - watcherSinceRef.current > WATCHER_FIRST_EVENT_MS
        ) {
          watcherSshIdRef.current = null;
          watcherFailedRef.current = true;
          void stopGitWatcher(sshId);
        } else {
          settledRef.current = true;
          setLoading(false);
          return;
        }
      }
      if (!liveRef.current || genRef.current !== gen) return;
      // STAGE 1 — fast branch probe (no diff, ~3 cheap commands). Skipped
      // while output streams and the last run is fresh: the busy shell's
      // cwd cannot change mid-stream, so this would only fork shells
      // against the agent. Quiet/focus/cd/force paths still refresh it.
      let cwdChanged = false;
      const stage1Due =
        force ||
        !shouldDeferRemoteFetch({
          now: Date.now(),
          lastActivityAt: lastActivityRef.current,
          lastFetchAt: lastStage1Ref.current,
          quietMs: SSH_QUIET_MS,
          maxStaleMs: SSH_STAGE1_BACKOFF_MS,
        });
      if (stage1Due) {
        lastStage1Ref.current = Date.now();
        try {
          const { cwd: cwdNow, branch } = await fetchSshCwdBranch(sshId);
          if (!liveRef.current || genRef.current !== gen) return;
          if (cwdNow !== null) {
            // A real move (not first populate): the human did `cd`.
            cwdChanged =
              lastCwdRef.current !== null && lastCwdRef.current !== cwdNow;
            lastCwdRef.current = cwdNow;
            setSshCwd(cwdNow);
          }
          setSummary((prev) => mergeBranchSummary(prev, branch));
          const prevCache = cacheRef.current.get(leafId);
          cacheRef.current.set(leafId, {
            summary: mergeBranchSummary(prevCache?.summary, branch),
            sshCwd: cwdNow ?? prevCache?.sshCwd ?? null,
          });
        } catch {
          if (!liveRef.current || genRef.current !== gen) return;
          // Keep previous display; stage 2 may still succeed. If it
          // doesn't, its own catch schedules the retry.
          scheduleFailureRetry(gen);
        }
      }
      // NOTE: no early return when skipped — stage 2 below keeps its own
      // independent cadence (its staleness caps still apply).
      // STAGE 2 — slow diff, gated unless the user is explicitly looking.
      const now = Date.now();
      if (!force) {
        const decision = gateSshFetch({
          now,
          agentBusy: agentBusyRef.current,
          lastActivityAt: lastActivityRef.current,
          lastFetchAt: lastFetchRef.current,
          cwdChanged,
        });
        if (decision === "skip") return;
        if (decision === "defer") {
          scheduleQuietRetry(gen);
          return;
        }
      }
      lastFetchRef.current = now;
      try {
        const diff = await fetchSshDiff(sshId);
        if (!liveRef.current || genRef.current !== gen) return;
        if (diff) {
          setSummary((prev) => applyDiffCounts(prev, diff));
          const prevCache = cacheRef.current.get(leafId);
          const merged = applyDiffCounts(prevCache?.summary ?? null, diff);
          if (merged) {
            cacheRef.current.set(leafId, {
              summary: merged,
              sshCwd: prevCache?.sshCwd ?? null,
            });
          }
        }
      } catch {
        if (!liveRef.current || genRef.current !== gen) return;
        // Counts stay at whatever stage 1 (or cache) shows.
        scheduleFailureRetry(gen);
      }
      settledRef.current = true;
      setLoading(false);
    } finally {
      if (inflightRef.current === gen) inflightRef.current = 0;
    }
  }, [cwd, leafId, isSSH, scheduleQuietRetry, scheduleFailureRetry, ensureWatcherForLeaf, scheduleOnRef]);
  fetchRef.current = fetch;

  // Manual refresh for the status chip click.
  const refresh = useCallback(() => {
    // Watcher path: forced polls are swallowed by design (nothing to
    // throttle), so run a one-shot merged probe — the click must always do
    // something visible. Fallback path: the forced legacy fetch below.
    if (isSSH && leafId !== null) {
      const sshId = ptyIdForLeaf(leafId);
      if (sshId !== null && watcherSshIdRef.current === sshId) {
        void withTimeout(
          scheduleSshExec(sshId, MERGED_SSH_GIT_SCRIPT),
          SSH_TIMEOUT_MS,
        )
          .then((result) => {
            const stat =
              /^STAT:(.*)$/m.exec(result.stdout)?.[1]?.trim() ?? "";
            applyRemoteGit(
              parseSshCwd(result.stdout),
              parseSshBranch(result.stdout),
              stat,
              leafId,
            );
          })
          .catch(() => {});
        return;
      }
    }
    void fetchRef.current(genRef.current, true);
  }, [isSSH, leafId, applyRemoteGit]);

  const clearRetries = useCallback(() => {
    for (const slot of [quietRetryRef, failureRetryRef, connectRetryRef]) {
      if (slot.current !== null) {
        clearTimeout(slot.current);
        slot.current = null;
      }
    }
  }, []);

  // #3 — refetch once when the window regains focus (probes were skipped
  // while hidden). Forced: the user is looking. Skips the very first run:
  // identity effect below already fetches on mount.
  const prevActiveRef = useRef(windowActive);
  useEffect(() => {
    const was = prevActiveRef.current;
    prevActiveRef.current = windowActive;
    if (windowActive && !was) void fetchRef.current(genRef.current, true);
  }, [windowActive]);

  // Watcher lifecycle: one daemon per leaf connection. Stops the previous
  // leaf's daemon on switch/unmount. Deliberately separate from the poll
  // effect below (which reruns on every cwd change): stopping there would
  // churn daemon + tail on each `cd`.
  useEffect(() => {
    if (!isSSH || leafId === null) {
      watcherFailedRef.current = false;
      return;
    }
    return () => {
      const watched = watcherSshIdRef.current;
      watcherSshIdRef.current = null;
      watcherFailedRef.current = false;
      if (watched !== null) void stopGitWatcher(watched);
    };
  }, [isSSH, leafId]);

  // Daemon emissions drive the chip. Matched by live sshId (M6-persistent,
  // so reconnect windows don't drop events).
  useEffect(() => {
    if (!isSSH || leafId === null) return;
    const onGitEvent = (e: Event) => {
      const d = (e as CustomEvent<GitWatchEvent>).detail;
      if (d.sshId !== ptyIdForLeaf(leafId)) return;
      applyRemoteGit(d.cwd, d.branch, d.shortstat, leafId);
    };
    window.addEventListener("terax:git-event", onGitEvent);
    return () => window.removeEventListener("terax:git-event", onGitEvent);
  }, [isSSH, leafId, applyRemoteGit]);

  useEffect(() => {
    liveRef.current = true;
    genRef.current += 1;
    const gen = genRef.current;
    clearRetries();
    // New leaf connection: previous leaf's timing state must not leak
    // (its activity would wrongly defer this leaf's probes).
    const timingKey = `${isSSH ? "ssh" : "local"}:${leafId}`;
    const leafChanged = timingKeyRef.current !== timingKey;
    if (leafChanged) {
      timingKeyRef.current = timingKey;
      lastActivityRef.current = 0;
      lastFetchRef.current = 0;
      lastStage1Ref.current = 0;
      lastCwdRef.current = null;
      connectAttemptsRef.current = 0;
    }
    settledRef.current = false;
    if (leafChanged && leafId !== null) {
      // Tab switch: show this leaf's own last-known data instantly (never
      // another tab's repo — the cache is keyed by leaf), then refresh.
      const cached = cacheRef.current.get(leafId);
      setSummary(cached?.summary ?? null);
      setSshCwd(cached?.sshCwd ?? null);
    } else {
      // Same leaf, new cwd (likely `cd` to another repo): blank is honest
      // until the forced refresh below lands (~one exec, not gated).
      setSummary(null);
      setSshCwd(null);
    }
    void fetch(gen, true);
    // Idle-aware chain (ThinkTerm-style backoff): reschedules from current
    // quiet time instead of a fixed 15s interval. Fresh sessions keep the
    // base cadence; long-quiet ones stretch toward the cap.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        timer = null;
        void fetch(gen);
        scheduleNext();
      }, nextPollInterval({ baseMs: POLL_MS, now: Date.now(), lastActivityAt: lastActivityRef.current }));
    };
    scheduleNext();

    if (isSSH && leafId !== null) {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const onSshActivity = (e: Event) => {
        const detail = (e as CustomEvent<{ leafId: number }>).detail;
        if (detail.leafId !== leafId) return;
        lastActivityRef.current = Date.now();
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void fetch(gen);
        }, SSH_ACTIVITY_DEBOUNCE_MS);
      };
      window.addEventListener("terax:ssh-activity", onSshActivity);
      return () => {
        liveRef.current = false;
        if (timer !== null) clearTimeout(timer);
        clearRetries();
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        window.removeEventListener("terax:ssh-activity", onSshActivity);
      };
    }

    return () => {
      liveRef.current = false;
      if (timer !== null) clearTimeout(timer);
      clearRetries();
    };
  }, [fetch, isSSH, leafId, clearRetries]);

  return { summary, sshCwd, loading, refresh };
}
