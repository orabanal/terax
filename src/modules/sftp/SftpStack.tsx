import type { Tab } from "@/modules/tabs";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import { SftpView } from "./SftpView";

type Props = {
  tabs: Tab[];
};

/**
 * Renders the single SFTP tab's surface. Mirrors the other *Stack components:
 * it returns null when no SFTP tab exists, and WorkspaceSurface toggles its
 * visibility so the view keeps its mounted state across tab switches.
 */
export function SftpStack({ tabs }: Props) {
  const exists = tabs.some((t) => t.kind === "sftp");
  // A single static reference time for deterministic date formatting in the
  // visual shell. Set once on mount; later milestones can refresh it.
  const [now] = useState(() => Date.now());
  // Home directory for the local pane's initial listing (resolved async).
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void homeDir()
      .then((h) => {
        if (alive) setHome(h.replace(/\\/g, "/").replace(/\/$/, ""));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!exists) return null;
  return <SftpView now={now} home={home} />;
}
