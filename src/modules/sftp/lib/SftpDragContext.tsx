import { createContext, useContext } from "react";
import type {
  SftpDragPayload,
  SftpDropTarget,
  SftpEntry,
  SftpPaneRef,
} from "./types";

/** Live drag state, shared from SftpView down to panes and the ghost. */
export type SftpDragState = {
  payload: SftpDragPayload;
  /** Cursor position in viewport coords, for the ghost. */
  x: number;
  y: number;
  /** Resolved drop target under the cursor, or null if none/invalid. */
  hovered: SftpDropTarget | null;
  /** True while over an invalid target (same pane as source). */
  invalid: boolean;
};

export type SftpDragContextValue = {
  /** Null when no drag is in progress. */
  drag: SftpDragState | null;
  /** Begins a drag with the picked-up entries from a source pane. */
  startDrag: (payload: SftpDragPayload, x: number, y: number) => void;
  /** Updates the ghost position and recomputes the hovered target. */
  moveDrag: (x: number, y: number) => void;
  /** Ends the drag, transferring into `target` if valid. */
  endDrag: () => void;
  /** Aborts the drag with no transfer. */
  cancelDrag: () => void;
  /** Imperative entry point used by context-menu "Move/Copy to other pane". */
  transferTo: (
    source: SftpPaneRef,
    entries: SftpEntry[],
    target: SftpPaneRef,
  ) => void;
  /** Registers a mounted pane so the drag layer can hit-test it. */
  registerPane: (ref: SftpPaneRef) => void;
  unregisterPane: (connKey: string) => void;
};

export const SftpDragContext = createContext<SftpDragContextValue | null>(null);

export function useSftpDrag(): SftpDragContextValue {
  const ctx = useContext(SftpDragContext);
  if (!ctx) {
    throw new Error("useSftpDrag must be used within SftpDragContext.Provider");
  }
  return ctx;
}
