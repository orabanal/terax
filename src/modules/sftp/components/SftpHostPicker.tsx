import {
  Globe02Icon,
  Home03Icon,
  Settings01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SshHost } from "@/modules/ssh/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Props = {
  hosts: SshHost[];
  onSelect: (host: SshHost) => void;
  onLocal: () => void;
  onManage?: () => void;
  disabled?: boolean;
};

export function SftpHostPicker({
  hosts,
  onSelect,
  onLocal,
  onManage,
  disabled,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
            disabled && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
        >
          <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
          Host
          <HugeiconsIcon icon={UnfoldMoreIcon} size={12} strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={onLocal} className="text-xs">
          <HugeiconsIcon icon={Home03Icon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
          Local
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {hosts.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No hosts configured
          </DropdownMenuItem>
        ) : (
          hosts.map((host) => (
            <DropdownMenuItem
              key={host.id}
              onClick={() => onSelect(host)}
              className="text-xs"
            >
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
              {host.name}
            </DropdownMenuItem>
          ))
        )}
        {onManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManage} className="text-xs">
              <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
              + Manage hosts...
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
