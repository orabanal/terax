import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState } from "react";
import type { SshHost } from "./store";

type Props = {
  host: SshHost | null;
  onConfirm: (host: SshHost, password: string) => void;
  onCancel: () => void;
};

export function SshPasswordDialog({ host, onConfirm, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (host) {
      setPassword("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [host]);

  const handleConfirm = () => {
    if (!host) return;
    onConfirm(host, password);
    setPassword("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
  };

  return (
    <Dialog open={host !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="w-80">
        <DialogHeader>
          <DialogTitle>SSH Password</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <p className="text-sm text-muted-foreground">
            Enter password for{" "}
            <span className="font-medium text-foreground">
              {host?.username}@{host?.host}
            </span>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-password" className="sr-only">
              Password
            </Label>
            <Input
              id="ssh-password"
              ref={inputRef}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
