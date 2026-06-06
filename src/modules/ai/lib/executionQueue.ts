/**
 * Per-session serial execution queue.
 * Prevents concurrent commands on the same terminal by serializing them
 * via a Promise-based slot system.
 */

type QueueSlot = {
  ready: Promise<void>;
  release: () => void;
};

type SessionQueue = {
  tail: Promise<void>;
  slots: Set<QueueSlot>;
};

const queues = new Map<string, SessionQueue>();

function getOrCreateQueue(sessionId: string): SessionQueue {
  let q = queues.get(sessionId);
  if (!q) {
    q = { tail: Promise.resolve(), slots: new Set() };
    queues.set(sessionId, q);
  }
  return q;
}

/**
 * Reserve a slot in the session's execution queue.
 * The returned `ready` promise resolves when it's this slot's turn to execute.
 * Call `release()` when the command finishes to let the next slot proceed.
 */
export function reserveSessionSlot(sessionId: string): QueueSlot {
  const q = getOrCreateQueue(sessionId);

  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = () => {
      q.slots.delete(slot);
      resolve();
      if (q.slots.size === 0) {
        queues.delete(sessionId);
      }
    };
  });

  const slot: QueueSlot = { ready, release };
  q.slots.add(slot);

  // Chain: this slot's ready resolves after the current tail
  const prevTail = q.tail;
  q.tail = q.tail.then(() => ready);

  // Wrap ready to wait for previous tail first
  const chainedReady = prevTail.then(() => {});
  slot.ready = chainedReady;

  return slot;
}

/**
 * Clear all pending slots for a session (e.g. when session is stopped).
 * Resolves all pending slots so they don't hang.
 */
export function clearSessionQueue(sessionId: string): void {
  const q = queues.get(sessionId);
  if (!q) return;
  for (const slot of q.slots) {
    slot.release();
  }
  queues.delete(sessionId);
}
