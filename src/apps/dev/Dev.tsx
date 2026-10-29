import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { Terminal } from "@/apps/terminal/Terminal";
import { useWindowStore } from "@/state/windows";
import type { AppProps } from "@/types";
import { DevCommunity } from "./DevCommunity";
import { Projects } from "./Projects";
import { Tools } from "./Tools";

/* ==========================================================================
   Crystal Dev

   Four areas around the same window: the terminal that already existed, the
   projects this browser profile holds, a bench of local utilities, and the
   community feed so getting unstuck does not mean leaving the workspace.

   The terminal itself is untouched — this shell renders it as one of its
   panes, so every command, shortcut and completion keeps working exactly as
   before.
   ========================================================================== */

type Area = "terminal" | "projects" | "tools" | "community";

const AREAS: { id: Area; label: string; icon: IconName; hint: string }[] = [
  { id: "terminal", label: "Terminal", icon: "terminal", hint: "Commands, history and completion" },
  { id: "projects", label: "Projects", icon: "folder", hint: "Files in this browser profile" },
  { id: "tools", label: "Tools", icon: "sliders", hint: "Local developer utilities" },
  { id: "community", label: "Community", icon: "users", hint: "Feed, questions and answers" },
];

function isArea(value: unknown): value is Area {
  return typeof value === "string" && AREAS.some((area) => area.id === value);
}

export function Dev({ windowId, args }: AppProps) {
  const [area, setArea] = useState<Area>(isArea(args?.area) ? args.area : "terminal");

  /* A launch argument can name the area — `open dev tools` or a link from
     another app. Kept as an effect as well as an initial value, because a
     singleton window that is already open receives new arguments without
     remounting. */
  useEffect(() => {
    if (isArea(args?.area)) setArea(args.area);
  }, [args?.area]);

  /* The catalogue renamed the terminal window to Crystal Dev; a window
     restored from an older session still carries the old title, so the shell
     corrects it once on mount instead of showing a stale name forever. */
  useEffect(() => {
    useWindowStore.getState().setTitle(windowId, "Crystal Dev");
  }, [windowId]);

  const active = AREAS.find((entry) => entry.id === area) ?? AREAS[0];

  return (
    <div className="cr-dev">
      <nav className="cr-dev__rail" aria-label="Crystal Dev areas">
        <div className="cr-dev__brand">
          <Icon name="terminal" size={15} />
          <span>Crystal Dev</span>
        </div>
        {AREAS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="cr-dev__rail-item"
            data-active={entry.id === area}
            title={entry.hint}
            onClick={() => setArea(entry.id)}
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
          </button>
        ))}
        <p className="cr-dev__rail-note">{active.hint}</p>
      </nav>

      <div className="cr-dev__area">
        {area === "terminal" && <Terminal windowId={windowId} args={args} />}
        {area === "projects" && <Projects />}
        {area === "tools" && <Tools />}
        {area === "community" && <DevCommunity />}
      </div>
    </div>
  );
}

export default Dev;
