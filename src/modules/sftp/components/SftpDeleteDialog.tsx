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
  /** Names targeted for deletion. */
  names?: string[];
};

/** Confirms deletion of one or more entries. Milestone 1: static, no delete. */
export function SftpDeleteDialog({ open, onOpenChange, names = [] }: Props) {
  const count = names.length;
  const summary =
    count === 1 ? names[0] : count > 1 ? `${count} items` : "selected items";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {summary}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone.
            {count > 1 && (
              <span className="mt-2 block truncate text-xs text-muted-foreground">
                {names.join(", ")}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
