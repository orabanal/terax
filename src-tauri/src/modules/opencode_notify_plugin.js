// Terax notifier plugin for OpenCode.
//
// Installed by Terax to ~/.config/opencode/plugins/terax-notify.js (locally)
// or the same path on SSH hosts. Hooks session/permission events and appends
// one JSON object per line to ~/.terax-opencode-events.jsonl, which Terax
// tails (local watcher / remote `tail -F`) to raise toasts + OS
// notifications — the same UX as Claude Code.
//
// Rules: never throw (a throwing hook can break the session), never block,
// no shell-outs. Pure fs append.
//
// Placeholders replaced by Terax at install time:
//   {{PLUGIN_VERSION}}  numeric version marker
//   {{EVENTS_FILE}}     events filename in $HOME (no path separators)
export const TeraxNotify = async ({ directory, project }) => {
  let fs = null;
  let os = null;
  try {
    fs = await import("node:fs/promises");
    os = await import("node:os");
  } catch {
    return {};
  }

  const eventsPath = `${os.homedir()}/{{EVENTS_FILE}}`;
  const projectName =
    (project && (project.name || project.id)) || "opencode";

  async function emit(kind, props) {
    try {
      const event = {
        v: 1,
        agent: "opencode",
        kind,
        sessionId:
          props?.sessionID ?? props?.sessionId ?? props?.id ?? null,
        directory: directory || null,
        project: projectName,
        detail: null,
        ts: Date.now(),
      };
      if (kind === "error") {
        const err = props?.error ?? props?.message ?? null;
        event.detail = String(err ?? "session error").slice(0, 300);
      } else if (kind === "attention") {
        const perm = props?.permission ?? props ?? null;
        const name =
          perm?.title ?? perm?.type ?? perm?.tool ?? perm?.name ?? null;
        event.detail = name
          ? `Permission: ${String(name).slice(0, 200)}`
          : "Permission requested";
      }
      await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`);
    } catch {
      // Ignore — notifications must never break the agent session.
    }
  }

  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.idle") {
          await emit("finished", event.properties);
        } else if (event.type === "session.error") {
          await emit("error", event.properties);
        } else if (event.type === "permission.asked") {
          await emit("attention", event.properties);
        }
      } catch {
        // Ignore.
      }
    },
  };
};

// terax-notify v{{PLUGIN_VERSION}}
