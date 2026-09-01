import { useTheme } from "@/modules/theme";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isSessionConnected } from "@/modules/terminal/lib/useTerminalSession";
import type { SshHost } from "@/modules/ssh/store";
import type { SearchAddon } from "@xterm/addon-search";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BlockInputBar, type BlockInputBarHandle } from "./block/BlockInputBar";
import { useTerminalSession } from "./lib/useTerminalSession";
import { useServerStats } from "./lib/useServerStats";
import { ServerStatsBar } from "./ServerStatsBar";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  /** Override the shell with an arbitrary argv (e.g. ["ssh", "user@host"]). */
  command?: string[];
  /** SSH host to connect to instead of opening a local PTY. */
  sshHost?: SshHost & { password?: string };
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      blocks = false,
      command,
      sshHost,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<BlockInputBarHandle>(null);
    const downYRef = useRef<number | null>(null);
    useTheme();

    const showServerStats = usePreferencesStore((s) => s.showServerStats);
    const serverStatsInterval = usePreferencesStore((s) => s.serverStatsInterval);

    // Track SSH connection state via events instead of polling.
    const [sshConnected, setSshConnected] = useState(() =>
      sshHost ? isSessionConnected(leafId) : false,
    );
    useEffect(() => {
      if (!sshHost) return;

      // Initial state check
      setSshConnected(isSessionConnected(leafId));

      // Listen to SSH activity events (fired on connect/disconnect)
      const handleActivity = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.leafId === leafId) {
          setSshConnected(isSessionConnected(leafId));
        }
      };

      window.addEventListener("terax:ssh-activity", handleActivity);
      return () => window.removeEventListener("terax:ssh-activity", handleActivity);
    }, [leafId, sshHost]);

    const statsEnabled = !!sshHost && showServerStats && sshConnected;

    const stats = useServerStats({
      leafId: statsEnabled ? leafId : null,
      enabled: statsEnabled,
      intervalSec: serverStatsInterval,
      visible,
    });

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      blocks,
      command,
      sshHost,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    if (blocks) {
      return (
        <div
          className="zoom-exempt absolute inset-0 flex flex-col"
          style={hideStyle}
        >
          <BlockInputBar
            ref={barRef}
            mode={session.blockMode}
            onSubmit={session.submitCommand}
            onInterrupt={session.interrupt}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
          <div
            ref={containerRef}
            className="relative min-h-0 flex-1"
            onMouseDown={(e) => {
              downYRef.current = e.clientY;
            }}
            onMouseUp={(e) => {
              const moved =
                downYRef.current != null &&
                Math.abs(e.clientY - downYRef.current) > 4;
              downYRef.current = null;
              if (!moved) session.selectBlockAt(e.clientY);
              if (session.blockMode === "prompt") barRef.current?.focus();
            }}
          />
        </div>
      );
    }

    // Always use two-layer structure so the DOM is stable regardless of
    // statsEnabled flips. containerRef.current must stay on the same node or
    // xterm ends up mounted in a detached element (useTerminalSession dep on
    // the ref object, not its .current, means the effect won't re-run).
    const barLabel = sshHost
      ? (sshHost.name || sshHost.host)
      : "Local terminal";

    return (
      <div className="zoom-exempt absolute inset-0 flex flex-col" style={hideStyle}>
        <ServerStatsBar stats={statsEnabled ? stats : null} emptyLabel={barLabel} />
        <div ref={containerRef} className="min-h-0 flex-1" />
      </div>
    );
  },
);
