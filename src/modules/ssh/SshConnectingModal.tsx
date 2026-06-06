import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  focusSlot,
  isSessionConnected,
  sshStatusListeners,
} from "@/modules/terminal/lib/useTerminalSession";

type Props = {
  leafId: number;
  hostName: string;
};

const DONE_STATES = ["Connected", "Error", "Failed", "Closed"];

export function SshConnectingModal({ leafId, hostName }: Props) {
  const [status, setStatus] = useState<string>("Connecting...");
  const [visible, setVisible] = useState(() => !isSessionConnected(leafId));

  useEffect(() => {
    if (isSessionConnected(leafId)) {
      setVisible(false);
      return;
    }

    setStatus("Connecting...");
    setVisible(true);

    sshStatusListeners.set(leafId, (msg: string) => {
      setStatus(msg);
      if (DONE_STATES.some((s) => msg.startsWith(s))) {
        if (msg.startsWith("Connected")) {
          setTimeout(() => focusSlot(leafId), 50);
        }
        setTimeout(() => setVisible(false), 400);
      }
    });

    return () => {
      sshStatusListeners.delete(leafId);
    };
  }, [leafId]);

  if (!visible) return null;

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
