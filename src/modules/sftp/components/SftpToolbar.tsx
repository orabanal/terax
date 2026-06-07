import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Bookmark01Icon,
  Bookmark02Icon,
  Cancel01Icon,
  EyeIcon,
  FileAddIcon,
  FolderAddIcon,
  Home09Icon,
  Refresh01Icon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type SftpBookmark = { path: string };

type Props = {
  path: string;
  filter: string;
  onFilterChange: (value: string) => void;
  bookmarks?: SftpBookmark[];
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onSelectBookmark?: (path: string) => void;
  onRemoveBookmark?: (path: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onUp?: () => void;
  onHome?: () => void;
  onRefresh?: () => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  onNavigateSegment?: (path: string) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  showHidden?: boolean;
  onToggleHidden?: () => void;
};

type Segment = { label: string; path: string };

function toSegments(path: string): Segment[] {
  const parts = path.split("/").filter(Boolean);
  const segments: Segment[] = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    segments.push({ label: part, path: acc });
  }
  return segments;
}

function NavButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: typeof Home09Icon;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={2} />
    </Button>
  );
}

export function SftpToolbar({
  path,
  filter,
  onFilterChange,
  bookmarks = [],
  isBookmarked = false,
  onToggleBookmark,
  onSelectBookmark,
  onRemoveBookmark,
  onBack,
  onForward,
  onUp,
  onHome,
  onRefresh,
  onNewFolder,
  onNewFile,
  onNavigateSegment,
  canGoBack,
  canGoForward,
  showHidden = false,
  onToggleHidden,
}: Props) {
  const segments = toSegments(path);

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border/60 px-2 py-1.5">
      <div className="flex items-center gap-0.5">
        <NavButton
          icon={ArrowLeft01Icon}
          title="Back"
          onClick={onBack}
          disabled={!canGoBack}
        />
        <NavButton
          icon={ArrowRight01Icon}
          title="Forward"
          onClick={onForward}
          disabled={!canGoForward}
        />
        <NavButton icon={ArrowUp01Icon} title="Up" onClick={onUp} />
        <NavButton icon={Home09Icon} title="Home" onClick={onHome} />
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <NavButton icon={Refresh01Icon} title="Refresh" onClick={onRefresh} />
        <NavButton
          icon={FolderAddIcon}
          title="New folder"
          onClick={onNewFolder}
        />
        <NavButton
          icon={FileAddIcon}
          title="New file"
          onClick={onNewFile}
        />
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 hover:text-foreground",
            showHidden ? "text-primary" : "text-muted-foreground",
          )}
          onClick={onToggleHidden}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
          aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          aria-pressed={showHidden}
        >
          <HugeiconsIcon
            icon={showHidden ? EyeIcon : ViewOffSlashIcon}
            size={13}
            strokeWidth={2}
          />
        </Button>
        <BookmarksMenu
          bookmarks={bookmarks}
          currentPath={path}
          isBookmarked={isBookmarked}
          onToggle={onToggleBookmark}
          onSelect={onSelectBookmark}
          onRemove={onRemoveBookmark}
        />
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter"
          className="ml-1 h-6 flex-1 text-xs"
        />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-xs text-muted-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {segments.map((seg, i) => (
          <span key={seg.path} className="flex shrink-0 items-center gap-0.5">
            {i > 1 && <span className="text-muted-foreground/50">/</span>}
            <button
              type="button"
              onClick={() => onNavigateSegment?.(seg.path)}
              className={cn(
                "max-w-40 truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground",
                i === segments.length - 1 && "text-foreground",
              )}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

function BookmarksMenu({
  bookmarks,
  currentPath,
  isBookmarked,
  onToggle,
  onSelect,
  onRemove,
}: {
  bookmarks: SftpBookmark[];
  currentPath: string;
  isBookmarked: boolean;
  onToggle?: () => void;
  onSelect?: (path: string) => void;
  onRemove?: (path: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 hover:text-foreground",
            isBookmarked ? "text-primary" : "text-muted-foreground",
          )}
          title="Bookmarks"
          aria-label="Bookmarks"
        >
          <HugeiconsIcon
            icon={isBookmarked ? Bookmark01Icon : Bookmark02Icon}
            size={13}
            strokeWidth={2}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 max-h-72">
        <DropdownMenuItem onSelect={onToggle}>
          <HugeiconsIcon
            icon={isBookmarked ? Bookmark01Icon : Bookmark02Icon}
            size={14}
            strokeWidth={1.75}
          />
          <span>{isBookmarked ? "Remove bookmark" : "Add bookmark"}</span>
        </DropdownMenuItem>
        {bookmarks.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Saved</DropdownMenuLabel>
            {bookmarks.map((b) => (
              <DropdownMenuItem
                key={b.path}
                onSelect={() => onSelect?.(b.path)}
                className={cn(b.path === currentPath && "text-primary")}
              >
                <HugeiconsIcon
                  icon={Bookmark01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{basename(b.path)}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {b.path}
                  </span>
                </span>
                <span
                  role="button"
                  aria-label="Remove bookmark"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove?.(b.path);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
