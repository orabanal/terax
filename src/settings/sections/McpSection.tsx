import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMcpServersStore } from "@/modules/ai/store/mcpServersStore";
import { newMcpServerId, type McpServer } from "@/modules/ai/lib/mcpServers";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
export function McpSection() {
  const servers = useMcpServersStore((s) => s.servers);
  const hydrate = useMcpServersStore((s) => s.hydrate);
  const upsert = useMcpServersStore((s) => s.upsert);
  const remove = useMcpServersStore((s) => s.remove);

  const [editing, setEditing] = useState<McpServer | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const openNew = () => {
    setEditing({
      id: newMcpServerId(),
      name: "",
      transport: "stdio",
      command: "",
      args: [],
      env: {},
      url: "",
      enabled: true,
    });
    setIsNew(true);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="MCP Servers"
        description="Connect Model Context Protocol servers to expose additional tools to the agent."
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-foreground">Configured servers</span>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={openNew}>
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            Add server
          </Button>
        </div>

        {servers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            <p className="text-[11.5px] text-muted-foreground">
              No MCP servers configured. Add one to extend the agent with external tools.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {servers.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5",
                  !s.enabled && "opacity-60",
                )}
              >
                <HugeiconsIcon
                  icon={ServerStack01Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-foreground">{s.name || "(unnamed)"}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {s.transport === "http" ? s.url : s.command}
                  </p>
                </div>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(v) => upsert({ ...s, enabled: v })}
                  className="shrink-0"
                />
                <button
                  type="button"
                  onClick={() => { setEditing({ ...s }); setIsNew(false); }}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <McpDialog
          server={editing}
          isNew={isNew}
          onSave={(srv) => { upsert(srv); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function McpDialog({
  server,
  isNew,
  onSave,
  onCancel,
}: {
  server: McpServer;
  isNew: boolean;
  onSave: (s: McpServer) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [transport, setTransport] = useState<"stdio" | "http">(server.transport ?? "stdio");
  const [command, setCommand] = useState(server.command ?? "");
  const [args, setArgs] = useState((server.args ?? []).join(" "));
  const [url, setUrl] = useState(server.url ?? "");

  const canSave =
    name.trim().length > 0 &&
    (transport === "http" ? url.trim().length > 0 : command.trim().length > 0);

  const handleSave = () => {
    onSave({
      ...server,
      name: name.trim(),
      transport,
      command: transport === "stdio" ? command.trim() : undefined,
      args: transport === "stdio" ? args.trim().split(/\s+/).filter(Boolean) : [],
      url: transport === "http" ? url.trim() : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isNew ? "Add MCP server" : "Edit MCP server"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
              className="text-[12px] h-8"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-foreground">Transport</label>
            <div className="flex gap-2">
              {(["stdio", "http"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(t)}
                  className={cn(
                    "flex h-7 items-center rounded-md border px-3 text-[11.5px] transition-colors",
                    transport === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {t === "stdio" ? "stdio (local)" : "HTTP (remote)"}
                </button>
              ))}
            </div>
          </div>

          {transport === "stdio" ? (
            <>
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium text-foreground">Command</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className="text-[12px] h-8 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium text-foreground">
                  Arguments <span className="text-muted-foreground font-normal">(space-separated, optional)</span>
                </label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="/path/to/directory"
                  className="text-[12px] h-8 font-mono"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="text-[11.5px] font-medium text-foreground">URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000/mcp"
                className="text-[12px] h-8 font-mono"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onCancel} className="text-[12px]">Cancel</Button>
          <Button size="sm" disabled={!canSave} onClick={handleSave} className="text-[12px]">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
