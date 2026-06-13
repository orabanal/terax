import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSshHostsStore, clearSshPassword, setSshPassword, getSshPassword, type SshHost, type SshAuthType } from "@/modules/ssh/store";
import {
  Cancel01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type HostForm = {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  password: string;
  keyPath: string;
  initialCommand: string;
  keepAliveInterval: string;
  keepAliveMax: string;
  connectTimeout: string;
  strictHostKeyChecking: string;
  compression: boolean;
};

const EMPTY_FORM: HostForm = {
  name: "",
  host: "",
  port: 22,
  username: "",
  authType: "key",
  password: "",
  keyPath: "",
  initialCommand: "",
  keepAliveInterval: "",
  keepAliveMax: "",
  connectTimeout: "",
  strictHostKeyChecking: "",
  compression: false,
};

function hostToForm(host: SshHost): HostForm {
  return {
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    authType: host.authType,
    password: "",
    keyPath: host.keyPath ?? "",
    initialCommand: host.initialCommand ?? "",
    keepAliveInterval: host.keepAliveInterval != null ? String(host.keepAliveInterval) : "",
    keepAliveMax: host.keepAliveMax != null ? String(host.keepAliveMax) : "",
    connectTimeout: host.connectTimeout != null ? String(host.connectTimeout) : "",
    strictHostKeyChecking: host.strictHostKeyChecking ?? "",
    compression: host.compression ?? false,
  };
}

export function SshSection() {
  const { hosts, hydrated, init, addHost, updateHost, deleteHost } = useSshHostsStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<HostForm>(EMPTY_FORM);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setAdding(true);
    setHasStoredPassword(false);
  };

  const openEdit = (host: SshHost) => {
    setForm(hostToForm(host));
    setEditing(host.id);
    setAdding(false);
    if (host.authType === "password") {
      getSshPassword(host.id).then((pw) => setHasStoredPassword(!!pw));
    } else {
      setHasStoredPassword(false);
    }
  };

  const cancel = () => {
    setAdding(false);
    setEditing(null);
    setHasStoredPassword(false);
  };

  const save = async () => {
    const keepAlive = parseInt(form.keepAliveInterval, 10);
    const keepMax = parseInt(form.keepAliveMax, 10);
    const timeout = parseInt(form.connectTimeout, 10);
    const data: Omit<SshHost, "id"> = {
      name: form.name,
      host: form.host,
      port: Number(form.port) || 22,
      username: form.username,
      authType: form.authType,
      keyPath: form.keyPath || undefined,
      initialCommand: form.initialCommand || undefined,
      keepAliveInterval: !Number.isNaN(keepAlive) && keepAlive > 0 ? keepAlive : undefined,
      keepAliveMax: !Number.isNaN(keepMax) && keepMax > 0 ? keepMax : undefined,
      connectTimeout: !Number.isNaN(timeout) && timeout > 0 ? timeout : undefined,
      strictHostKeyChecking: (form.strictHostKeyChecking as SshHost["strictHostKeyChecking"]) || undefined,
      compression: form.compression || undefined,
    };
    let hostId: string;
    if (editing) {
      await updateHost(editing, data);
      hostId = editing;
    } else {
      hostId = await addHost(data);
    }
    if (form.authType === "password" && form.password) {
      await setSshPassword(hostId, form.password);
    } else if (form.authType !== "password") {
      await clearSshPassword(hostId);
    }
    setAdding(false);
    setEditing(null);
    setHasStoredPassword(false);
  };

  const isFormOpen = adding || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">SSH Hosts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Saved connections appear in the new tab menu.
          </p>
        </div>
        {!isFormOpen && (
          <Button variant="outline" size="sm" onClick={openAdd} className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />
            Add host
          </Button>
        )}
      </div>

      {hydrated && hosts.length === 0 && !isFormOpen && (
        <p className="text-sm text-muted-foreground">No SSH hosts configured yet.</p>
      )}

      {hosts.length > 0 && (
        <div className="space-y-1">
          {hosts.map((host) => (
            <div
              key={host.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5"
            >
              <HugeiconsIcon icon={ServerStack01Icon} size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{host.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {host.username}@{host.host}:{host.port}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(host)}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.75} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => { void clearSshPassword(host.id); void deleteHost(host.id); }}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <div className="space-y-3 rounded-lg border border-border/50 bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            {editing ? "Edit host" : "New host"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My server"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Host</label>
              <Input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.1"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Port</label>
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                placeholder="22"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Username</label>
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="root"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Authentication</label>
              <Select
                value={form.authType}
                onValueChange={(v) => setForm((f) => ({ ...f, authType: v as SshAuthType }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="key">Private key</SelectItem>
                  <SelectItem value="password">Password (interactive)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.authType === "key" && (
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground">Key path</label>
                <Input
                  value={form.keyPath}
                  onChange={(e) => setForm((f) => ({ ...f, keyPath: e.target.value }))}
                  placeholder="~/.ssh/id_rsa"
                  className="h-8 text-sm"
                />
              </div>
            )}
            {form.authType === "password" && (
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground">Password</label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={hasStoredPassword ? "Leave blank to keep current password" : "Password"}
                  className="h-8 text-sm"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">Initial command (optional)</label>
              <Input
                value={form.initialCommand}
                onChange={(e) => setForm((f) => ({ ...f, initialCommand: e.target.value }))}
                placeholder="tmux attach || tmux"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <p className="text-xs font-medium text-muted-foreground pt-1">Advanced options</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Keepalive interval (sec)</label>
              <Input
                type="number"
                value={form.keepAliveInterval}
                onChange={(e) => setForm((f) => ({ ...f, keepAliveInterval: e.target.value }))}
                placeholder="60"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Keepalive max retries</label>
              <Input
                type="number"
                value={form.keepAliveMax}
                onChange={(e) => setForm((f) => ({ ...f, keepAliveMax: e.target.value }))}
                placeholder="3"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Connect timeout (sec)</label>
              <Input
                type="number"
                value={form.connectTimeout}
                onChange={(e) => setForm((f) => ({ ...f, connectTimeout: e.target.value }))}
                placeholder="10"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Host key checking</label>
              <Select
                value={form.strictHostKeyChecking || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, strictHostKeyChecking: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Default</SelectItem>
                  <SelectItem value="accept-new">Accept new</SelectItem>
                  <SelectItem value="yes">Strict (yes)</SelectItem>
                  <SelectItem value="no">Disabled (no)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="ssh-compression"
                checked={form.compression}
                onChange={(e) => setForm((f) => ({ ...f, compression: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="ssh-compression" className="text-sm text-foreground">Compression</label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!form.name.trim() || !form.host.trim() || !form.username.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
