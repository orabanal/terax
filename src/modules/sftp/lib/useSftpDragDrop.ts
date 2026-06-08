import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SftpDragPayload,
  SftpDropTarget,
  SftpEntry,
  SftpPaneRef,
} from "./types";
import type { SftpDragState, SftpDragContextValue } from "./SftpDragContext";
import { useTransferQueue, type TransferQueue } from "./useTransferQueue";

/** Pixels the cursor must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Resolves the drop target under the cursor from the DOM + pane registry. */
function resolveTarget(
  x: number,
  y: number,
  panes: Map<string, SftpPaneRef>,
): SftpDropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const paneEl = el?.closest<HTMLElement>("[data-sftp-pane]");
  if (!paneEl) return null;
  const connKey = paneEl.getAttribute("data-conn-key");
  if (!connKey) return null;
  const pane = panes.get(connKey);
  if (!pane) return null;

  let intoDir = pane.path;
  const rowEl = el?.closest<HTMLElement>("[data-row-name]");
  if (rowEl) {
    const name = rowEl.getAttribute("data-row-name");
    const kind = rowEl.getAttribute("data-row-kind");
    if (kind === "dir" && name && name !== "..") {
      intoDir = joinPath(pane.path, name);
    }
  }
  return { pane, intoDir };
}

export type SftpDragDrop = {
  context: SftpDragContextValue;
  queue: TransferQueue;
};

/**
 * Owns the live drag gesture and the transfer queue for the whole SFTP view.
 * Panes register themselves so drops can be hit-tested against the DOM, and
 * call startDrag once the press passes the movement threshold.
 */
export function useSftpDragDrop(): SftpDragDrop {
  const queue = useTransferQueue();
  const [drag, setDrag] = useState<SftpDragState | null>(null);
  const dragRef = useRef<SftpDragState | null>(null);
  const panesRef = useRef<Map<string, SftpPaneRef>>(new Map());

  const setDragState = useCallback((next: SftpDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const registerPane = useCallback((ref: SftpPaneRef) => {
    panesRef.current.set(ref.connKey, ref);
  }, []);

  const unregisterPane = useCallback((connKey: string) => {
    panesRef.current.delete(connKey);
  }, []);

  const computeHover = useCallback((x: number, y: number, payload: SftpDragPayload) => {
    const target = resolveTarget(x, y, panesRef.current);
    const invalid = !target || target.pane.connKey === payload.source.connKey;
    return { hovered: invalid ? null : target, invalid: !!target && invalid };
  }, []);

  const startDrag = useCallback(
    (payload: SftpDragPayload, x: number, y: number) => {
      const { hovered, invalid } = computeHover(x, y, payload);
      setDragState({ payload, x, y, hovered, invalid });
    },
    [computeHover, setDragState],
  );

  const moveDrag = useCallback(
    (x: number, y: number) => {
      const cur = dragRef.current;
      if (!cur) return;
      const { hovered, invalid } = computeHover(x, y, cur.payload);
      setDragState({ ...cur, x, y, hovered, invalid });
    },
    [computeHover, setDragState],
  );

  const cancelDrag = useCallback(() => setDragState(null), [setDragState]);

  const endDrag = useCallback(() => {
    const cur = dragRef.current;
    setDragState(null);
    if (!cur?.hovered || cur.invalid) return;
    const dest: SftpPaneRef = { ...cur.hovered.pane, path: cur.hovered.intoDir };
    queue.enqueue(cur.payload.source, cur.payload.entries, dest);
  }, [queue, setDragState]);

  const transferTo = useCallback(
    (source: SftpPaneRef, entries: SftpEntry[], target: SftpPaneRef) => {
      queue.enqueue(source, entries, target);
    },
    [queue],
  );

  // Global listeners only while a drag is live.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
    const onUp = () => endDrag();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, moveDrag, endDrag, cancelDrag]);

  const context: SftpDragContextValue = {
    drag,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    transferTo,
    registerPane,
    unregisterPane,
  };

  return { context, queue };
}

export { DRAG_THRESHOLD };
