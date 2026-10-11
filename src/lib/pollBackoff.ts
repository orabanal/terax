/**
 * ThinkTerm-style idle backoff for background SSH polls (stats, git).
 * Their I/O loop doubles its sleep while idle (100ms→2s); here the same
 * idea stretches poll intervals while a session produces no output, so
 * quiet-but-visible panes stop opening exec channels every few seconds.
 *
 * Pure and unit-tested; callers reschedule with the returned delay after
 * every tick (timeout chains, not fixed setInterval).
 */

/** Hard ceiling for any backed-off poll. */
export const POLL_BACKOFF_MAX_MS = 60_000;

export type PollBackoffInput = {
  /** Base cadence (the setting's interval). */
  baseMs: number;
  now: number;
  /** Last PTY output timestamp, 0/negative when nothing observed yet. */
  lastActivityAt: number;
  /** Ceiling override (tests, special cases). */
  maxMs?: number;
};

/**
 * Next delay: base cadence while fresh, doubling per quiet base-period
 * once idle, capped. "Never saw activity" counts as fresh (not idle) so
 * the second tick after mount isn't pushed to the ceiling.
 */
export function nextPollInterval(input: PollBackoffInput): number {
  const maxMs = input.maxMs ?? POLL_BACKOFF_MAX_MS;
  const baseMs = Math.max(1, Math.round(input.baseMs));
  if (input.lastActivityAt <= 0) return Math.min(baseMs, maxMs);
  const idleMs = input.now - input.lastActivityAt;
  if (idleMs <= baseMs) return Math.min(baseMs, maxMs);
  const steps = Math.floor(idleMs / baseMs);
  const grown = baseMs * 2 ** Math.min(steps, 10);
  return Math.min(grown, maxMs);
}
