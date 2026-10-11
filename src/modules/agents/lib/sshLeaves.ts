import type { Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal/lib/panes";

export type SshLeafRef = { leafId: number; tabId: number };

export type SshLeafReaders = {
  hasSshSession: (leafId: number) => boolean;
};

/** SSH leaves by live leaf-level session — never by tab. Grafted SSH panes
 *  keep their session inside tabs whose own sshHostId belongs elsewhere (or
 *  nowhere), so tab-gating silently dropped them from tracking, tails, and
 *  plugin setup. Readers injectable for tests. */
export function collectSshLeaves(
  tabs: Tab[],
  read: SshLeafReaders,
): SshLeafRef[] {
  const result: SshLeafRef[] = [];
  for (const t of tabs) {
    if (t.kind !== "terminal") continue;
    for (const lId of leafIds(t.paneTree)) {
      if (read.hasSshSession(lId)) result.push({ leafId: lId, tabId: t.id });
    }
  }
  return result;
}
