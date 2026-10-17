import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/icons/Icon";
import { Badge } from "@/components/ui";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { MAX_WORKSPACES, useWorkspaceStore } from "@/state/workspaces";

/* ==========================================================================
   Workspace overview

   Every workspace, what is on it, and which one is in front. A workspace is an
   organisational move rather than a restart: the windows on the others keep
   running, and the overview says how many, so switching is never a guess.
   ========================================================================== */

const MAX_TITLES = 4;

export function WorkspaceOverview() {
  const open = useShellStore((state) => state.workspaceOverviewOpen);
  const setOpen = useShellStore((state) => state.setWorkspaceOverviewOpen);
  const windows = useWindowStore((state) => state.windows);

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const activate = useWorkspaceStore((state) => state.activate);
  const create = useWorkspaceStore((state) => state.create);
  const rename = useWorkspaceStore((state) => state.rename);
  const remove = useWorkspaceStore((state) => state.remove);

  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  // Opening always starts on the workspace that is currently in front.
  useEffect(() => {
    if (!open) return;
    const index = workspaces.findIndex((workspace) => workspace.id === activeId);
    setCursor(index < 0 ? 0 : index);
    setEditing(null);
  }, [open, activeId, workspaces]);

  /** Windows grouped by workspace. Sticky windows belong to every workspace. */
  const byWorkspace = useMemo(() => {
    const map = new Map<string, { title: string; appId: string }[]>();
    for (const entry of windows) {
      if (entry.sticky) continue;
      const id = entry.workspaceId ?? activeId;
      const list = map.get(id) ?? [];
      list.push({ title: entry.title, appId: entry.appId });
      map.set(id, list);
    }
    return map;
  }, [windows, activeId]);

  const stickyCount = useMemo(() => windows.filter((entry) => entry.sticky).length, [windows]);

  const commitRename = () => {
    if (editing) rename(editing, draft);
    setEditing(null);
  };

  if (!open) return null;

  const close = () => setOpen(false);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (editing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, workspaces.length - 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = workspaces[cursor];
      if (target) {
        activate(target.id);
        close();
      }
      return;
    }
    // 1–9 jump straight to a workspace, matching Ctrl+Alt+number.
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      const target = workspaces[digit - 1];
      if (target) {
        event.preventDefault();
        activate(target.id);
        close();
      }
    }
  };

  return (
    <div
      className="cr-overview-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="cr-overview"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace overview"
        onKeyDown={onKeyDown}
        ref={gridRef}
      >
        <header className="cr-overview__head">
          <Icon name="layout" size={16} />
          <h2>Workspaces</h2>
          <span className="cr-overview__sub">
            {workspaces.length} of {MAX_WORKSPACES}
            {stickyCount > 0 ? ` · ${stickyCount} on every workspace` : ""}
          </span>
        </header>

        <div className="cr-overview__grid">
          {workspaces.map((workspace, index) => {
            const owned = byWorkspace.get(workspace.id) ?? [];
            const isActive = workspace.id === activeId;
            const isCursor = index === cursor;
            return (
              <article
                key={workspace.id}
                className="cr-overview__card"
                data-active={isActive}
                data-cursor={isCursor}
                onPointerEnter={() => setCursor(index)}
              >
                <button
                  type="button"
                  className="cr-overview__preview"
                  onClick={() => {
                    activate(workspace.id);
                    close();
                  }}
                  aria-label={`Switch to ${workspace.name}`}
                >
                  <span className="cr-overview__preview-head">
                    <Icon name={workspace.icon} size={15} />
                    {editing === workspace.id ? (
                      <input
                        className="cr-overview__rename"
                        value={draft}
                        autoFocus
                        aria-label="Workspace name"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="cr-overview__name">{workspace.name}</span>
                    )}
                    {isActive && <Badge tone="accent">Current</Badge>}
                  </span>

                  <span className="cr-overview__windows">
                    {owned.length === 0 ? (
                      <span className="cr-overview__empty">Empty</span>
                    ) : (
                      owned
                        .slice(0, MAX_TITLES)
                        .map((entry, position) => (
                          <span className="cr-overview__window" key={`${entry.appId}-${position}`}>
                            {entry.title || entry.appId}
                          </span>
                        ))
                    )}
                    {owned.length > MAX_TITLES && (
                      <span className="cr-overview__more">+{owned.length - MAX_TITLES} more</span>
                    )}
                  </span>

                  <span className="cr-overview__count">
                    {owned.length} window{owned.length === 1 ? "" : "s"}
                  </span>
                </button>

                <div className="cr-overview__actions">
                  <button
                    type="button"
                    className="cr-overview__action"
                    aria-label={`Rename ${workspace.name}`}
                    title="Rename"
                    onClick={() => {
                      setEditing(workspace.id);
                      setDraft(workspace.name);
                    }}
                  >
                    <Icon name="pencil" size={12} />
                  </button>
                  <button
                    type="button"
                    className="cr-overview__action"
                    aria-label={`Close ${workspace.name} and move its windows`}
                    title={
                      workspaces.length <= 1
                        ? "The last workspace cannot be removed"
                        : "Remove this workspace"
                    }
                    disabled={workspaces.length <= 1}
                    onClick={() => {
                      // Windows are never destroyed by removing a workspace;
                      // the store moves them to the workspace that takes over.
                      remove(workspace.id);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </article>
            );
          })}

          {workspaces.length < MAX_WORKSPACES && (
            <button
              type="button"
              className="cr-overview__card cr-overview__card--new"
              onClick={() => {
                const id = create();
                activate(id);
              }}
            >
              <Icon name="plus" size={16} />
              <span>New workspace</span>
            </button>
          )}
        </div>

        <footer className="cr-overview__foot">
          <span className="cr-overview__hints">
            <kbd>←</kbd>
            <kbd>→</kbd> move
            <kbd>↵</kbd> switch
            <kbd>1</kbd>–<kbd>9</kbd> jump
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
