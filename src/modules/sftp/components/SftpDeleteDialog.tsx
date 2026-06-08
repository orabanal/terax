import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  names?: string[];
  onConfirm?: () => void;
};

export function SftpDeleteDialog({
  open,
  onOpenChange,
  names = [],
  onConfirm,
}: Props) {
  const count = names.length;
  const summary =
    count === 1 ? names[0] : count > 1 ? `${count} items` : "selected items";

  // Cap how many names we spell out so a large selection can't push the
  // footer off-screen; the rest collapse into a "+N more" tail.
  const MAX_LISTED = 5;
  const listed = names.slice(0, MAX_LISTED);
  const overflow = count - listed.length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle>Delete {summary}?</AlertDialogTitle>
          <AlertDialogDescription className="min-w-0">
            This cannot be undone.
            {count > 1 && (
              <span className="mt-2 block max-h-24 overflow-y-auto break-words text-xs text-muted-foreground">
                {listed.join(", ")}
                {overflow > 0 && ` +${overflow} more`}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90 dark:text-black"
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
