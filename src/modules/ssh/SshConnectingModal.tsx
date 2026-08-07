import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  clearSshDisconnected,
  focusSlot,
  isSessionConnected,
  isSshDisconnected,
  respawnSession,
  sshStatusListeners,
} from "@/modules/terminal/lib/useTerminalSession";

type Props = {
  leafId: number;
  hostName: string;
  onClose: () => void;
};

type Phase = "connecting" | "disconnected" | "hidden";

const DONE_STATES = ["Connected", "Error", "Failed", "Closed"];

export function SshConnectingModal({ leafId, hostName, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    isSshDisconnected(leafId)
      ? "disconnected"
      : isSessionConnected(leafId)
        ? "hidden"
        : "connecting",
  );
  const [status, setStatus] = useState<string>("Connecting...");

  useEffect(() => {
    // A disconnect may have happened while this leaf was out of the tree
    // (e.g. pane closed and re-added); recover that state on mount.
    if (isSshDisconnected(leafId)) {
      setPhase("disconnected");
    } else if (isSessionConnected(leafId)) {
      setPhase("hidden");
      return;
    }

    setStatus("Connecting...");
    setPhase("connecting");

    sshStatusListeners.set(leafId, (msg: string) => {
      if (msg === "Disconnected") {
        setPhase("disconnected");
        return;
      }
      setStatus(msg);
      setPhase("connecting");
      if (DONE_STATES.some((s) => msg.startsWith(s))) {
        if (msg.startsWith("Connected")) {
          setTimeout(() => focusSlot(leafId), 50);
        }
        setTimeout(() => setPhase("hidden"), 400);
      }
    });

    return () => {
      sshStatusListeners.delete(leafId);
    };
  }, [leafId]);

  if (phase === "hidden") return null;

  if (phase === "disconnected") {
    return (
      <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex w-72 flex-col gap-3 rounded-lg border border-border bg-background px-5 py-4 shadow-lg">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-destructive uppercase tracking-wide">
              Connection lost
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {hostName}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            The SSH connection was closed unexpectedly.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                setPhase("connecting");
                setStatus("Connecting...");
                void respawnSession(leafId);
              }}
            >
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearSshDisconnected(leafId);
                onClose();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-72 flex-col gap-3 rounded-lg border border-border bg-background px-5 py-4 shadow-lg">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            SSH
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {hostName}
          </span>
        </div>
        <ProgressBar />
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
    </div>
  );
}

function ProgressBar() {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
      aria-hidden="true"
    >
      <div
        className={cn(
          "h-full w-1/2 rounded-full bg-primary",
          "animate-[ssh-progress_1.4s_ease-in-out_infinite]",
        )}
      />
    </div>
  );
}
