import { Button } from "@/components/ui/button";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  onConnect?: () => void;
};

/** Shown in the remote pane before a host connection exists. */
export function SftpEmptyState({ onConnect }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <HugeiconsIcon
        icon={ServerStack01Icon}
        size={28}
        strokeWidth={1.5}
        className="text-muted-foreground"
      />
      <div className="text-xs text-muted-foreground">
        Not connected to a remote host
      </div>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onConnect}>
        Connect to host
      </Button>
    </div>
  );
}
