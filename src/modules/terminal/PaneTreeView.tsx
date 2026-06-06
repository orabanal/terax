import { Fragment } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import type { SshHost } from "@/modules/ssh/store";
import type { SplitDir } from "@/modules/terminal/lib/panes";
import type { SearchAddon } from "@xterm/addon-search";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { useTerminalDropStore } from "./lib/dropStore";
import type { PaneNode } from "./lib/panes";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  command?: string[];
  sshHost?: SshHost & { password?: string };
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  hoveredLeafId: number | null;
  onHoverLeaf: (leafId: number | null) => void;
  multiPane: boolean;
  onSplit?: (dir: SplitDir) => void;
  onClosePane?: (leafId: number) => void;
  onExtractToTab?: (leafId: number) => void;
};

export function PaneTreeView({
  node,
  tabVisible,
  activeLeafId,
  blocks,
  command,
  sshHost,
  onFocusLeaf,
  getBundle,
  hoveredLeafId,
  onHoverLeaf,
  multiPane,
  onSplit,
  onClosePane,
  onExtractToTab,
}: Props) {
  if (node.kind === "leaf") {
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    const isHovered = hoveredLeafId === node.id;
    const dimmed = multiPane && hoveredLeafId !== null && !isHovered;
    const showBorder = multiPane && isHovered;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onMouseDownCapture={() => {
              if (!focused) onFocusLeaf(node.id);
            }}
            onFocus={() => {
              if (!focused) onFocusLeaf(node.id);
            }}
            onMouseEnter={() => {
              onHoverLeaf(node.id);
              if (!focused) onFocusLeaf(node.id);
            }}
            data-pane-leaf={node.id}
            className={cn(
              "relative h-full w-full transition-[filter] duration-150",
              showBorder && "ring-1 ring-inset ring-border/60",
            )}
            style={dimmed ? { filter: "brightness(0.7)" } : undefined}
          >
            <TerminalPane
              leafId={node.id}
              visible={tabVisible}
              focused={focused}
              initialCwd={node.cwd}
              blocks={blocks}
              command={command}
              sshHost={sshHost}
              ref={b.setRef}
              onSearchReady={(_id, addon) => b.onSearch(addon)}
              onCwd={(_id, cwd) => b.onCwd(cwd)}
              onExit={(_id, code) => b.onExit(code)}
            />
            <DropOverlay leafId={node.id} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-44"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ContextMenuItem onSelect={() => onSplit?.("row")}>
            <HugeiconsIcon
              icon={LayoutTwoColumnIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Split horizontal</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onSplit?.("col")}>
            <HugeiconsIcon
              icon={LayoutTwoRowIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Split vertical</span>
          </ContextMenuItem>
          {multiPane && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onExtractToTab?.(node.id)}>
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Return to tab</span>
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onClosePane?.(node.id)}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Close terminal</span>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView
              node={child}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              blocks={blocks}
              command={command}
              sshHost={sshHost}
              onFocusLeaf={onFocusLeaf}
              getBundle={getBundle}
              hoveredLeafId={hoveredLeafId}
              onHoverLeaf={onHoverLeaf}
              multiPane={true}
              onSplit={onSplit}
              onClosePane={onClosePane}
              onExtractToTab={onExtractToTab}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
