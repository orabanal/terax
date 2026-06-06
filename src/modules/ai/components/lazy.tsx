import { lazy, Suspense } from "react";
import type { AgentRunBridgeProps } from "./AgentRunBridge";
import type { AiSidebarProps } from "./AiSidebar";

const AgentRunBridgeInner = lazy(() =>
  import("./AgentRunBridge").then((m) => ({ default: m.AgentRunBridge })),
);

const AiSidebarInner = lazy(() =>
  import("./AiSidebar").then((m) => ({ default: m.AiSidebar })),
);

export function AgentRunBridge(props: AgentRunBridgeProps) {
  return (
    <Suspense fallback={null}>
      <AgentRunBridgeInner {...props} />
    </Suspense>
  );
}

export function AiSidebar(props: AiSidebarProps) {
  return (
    <Suspense fallback={null}>
      <AiSidebarInner {...props} />
    </Suspense>
  );
}
