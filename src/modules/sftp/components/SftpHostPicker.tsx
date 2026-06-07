import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ServerStack01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Host = { id: string; name: string };

type Props = {
  hosts: Host[];
  /** Inert in Milestone 1. */
  onSelect?: (hostId: string) => void;
};

/** Dropdown that picks the remote host for the right pane. */
export function SftpHostPicker({ hosts, onSelect }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ServerStack01Icon} size={13} strokeWidth={2} />
          <span>Host</span>
          <HugeiconsIcon icon={UnfoldMoreIcon} size={12} strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Connect to host</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hosts.length === 0 ? (
          <DropdownMenuItem disabled>No SSH hosts configured</DropdownMenuItem>
        ) : (
          hosts.map((host) => (
            <DropdownMenuItem key={host.id} onSelect={() => onSelect?.(host.id)}>
              <HugeiconsIcon
                icon={ServerStack01Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1 truncate">{host.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
