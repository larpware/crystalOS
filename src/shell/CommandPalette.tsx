import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/icons/Icon";
import { useShellStore } from "@/state/shell";
import {
  commandCategoryOrder,
  runCommand,
  searchRegisteredCommands,
  useCommandHistory,
  type Command,
  type CommandCategory,
} from "@/services/commands";
import { notify } from "@/services/os";

/* ==========================================================================
   CrystalOS Quick Search

   A single input over the command registry. Everything the OS can do is
   already a registered command, so this component owns no behaviour of its own:
   it searches, it ranks, and it asks the registry to run the result. That is
   why a command reached from here and the same action reached from a shortcut
   take exactly one code path.
   ========================================================================== */

interface Group {
  category: CommandCategory | "Recent";
  commands: Command[];
}

const MAX_RESULTS = 60;

export function CommandPalette() {
  const open = useShellStore((state) => state.commandPaletteOpen);
  const setOpen = useShellStore((state) => state.setCommandPaletteOpen);
  const recent = useCommandHistory((state) => state.recent);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Each opening starts clean: no stale query, no stale error.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setPending(null);
    setError(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  /** Ranked matches, plus a Recent group when the query is empty. */
  const groups = useMemo<Group[]>(() => {
    if (!open) return [];
    const matches = query.trim()
      ? searchRegisteredCommands(query, MAX_RESULTS)
      : searchRegisteredCommands("", MAX_RESULTS);

    const byCategory = new Map<CommandCategory, Command[]>();
    for (const command of matches) {
      const list = byCategory.get(command.category) ?? [];
      list.push(command);
      byCategory.set(command.category, list);
    }

    const result: Group[] = [];
    // With nothing typed, what you ran last is the most likely answer.
    if (!query.trim() && recent.length > 0) {
      const recentCommands = recent
        .map((id) => matches.find((command) => command.id === id))
        .filter((command): command is Command => Boolean(command))
        .slice(0, 5);
      if (recentCommands.length > 0) result.push({ category: "Recent", commands: recentCommands });
    }
    for (const category of commandCategoryOrder) {
      const list = byCategory.get(category);
      if (list && list.length > 0) result.push({ category, commands: list });
    }
    return result;
  }, [open, query, recent]);

  /** The flat order the cursor walks, which is what the user actually sees. */
  const flat = useMemo(() => groups.flatMap((group) => group.commands), [groups]);
  const active = flat[Math.min(cursor, Math.max(0, flat.length - 1))];

  // Keep the highlighted row in view without stealing the whole list's scroll.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [open, cursor, groups]);

  if (!open) return null;

  /** Runs a command and reports a refusal in place, without closing the box. */
  const execute = async (command: Command) => {
    setBusy(true);
    const result = await runCommand(command.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (command.announce) {
      notify({ title: command.announce, icon: command.icon ?? "check" });
    }
    if (!command.keepOpen) setOpen(false);
  };

  const run = (command: Command) => {
    // A destructive command stops here until the confirmation strip is
    // acknowledged; nothing is executed on the way through.
    if (command.confirm) {
      setPending(command);
      return;
    }
    void execute(command);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (pending) {
        setPending(null);
        return;
      }
      setOpen(false);
      return;
    }
    if (pending) return; // the confirmation owns Enter and Tab

    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setCursor((value) => (flat.length === 0 ? 0 : (value + 1) % flat.length));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setCursor((value) => (flat.length === 0 ? 0 : (value - 1 + flat.length) % flat.length));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setCursor(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setCursor(Math.max(0, flat.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active) run(active);
    }
  };

  let index = -1;

  return (
    <div
      className="cr-palette-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="cr-palette"
        role="dialog"
        aria-modal="true"
        aria-label="CrystalOS Quick Search"
        onKeyDown={onKeyDown}
      >
        <div className="cr-palette__search">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            className="cr-palette__input"
            value={query}
            placeholder="Search commands, apps, games, layouts…"
            aria-label="Search commands"
            aria-controls="cr-palette-results"
            aria-activedescendant={active ? `cr-palette-${active.id}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
              setError(null);
            }}
          />
          <kbd className="cr-palette__kbd">Esc</kbd>
        </div>

        <div className="cr-palette__results" id="cr-palette-results" ref={listRef} role="listbox">
          {flat.length === 0 ? (
            <div className="cr-palette__empty">
              <Icon name="search" size={18} />
              <p>No command matches “{query.trim()}”</p>
              <span>Try an application name, a layout, or a setting.</span>
            </div>
          ) : (
            groups.map((group) => (
              <div className="cr-palette__group" key={group.category}>
                <div className="cr-palette__group-label">{group.category}</div>
                {group.commands.map((command) => {
                  index += 1;
                  const isActive = active?.id === command.id;
                  return (
                    <button
                      key={command.id}
                      id={`cr-palette-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      className="cr-palette__row"
                      onPointerMove={() => setCursor(index)}
                      onClick={() => void run(command)}
                    >
                      <span className="cr-palette__icon">
                        <Icon name={command.icon ?? "sparkle"} size={15} />
                      </span>
                      <span className="cr-palette__text">
                        <span className="cr-palette__name">{command.name}</span>
                        {command.description && (
                          <span className="cr-palette__desc">{command.description}</span>
                        )}
                      </span>
                      {command.hint && <kbd className="cr-palette__hint">{command.hint}</kbd>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {pending && (
          <div className="cr-palette__confirm" role="alertdialog" aria-label="Confirm command">
            <Icon name="warning" size={15} />
            <span className="cr-palette__confirm-text">
              {pending.confirm ?? `Run “${pending.name}”?`}
            </span>
            <button
              type="button"
              className="cr-palette__confirm-btn cr-palette__confirm-btn--go"
              disabled={busy}
              autoFocus
              onClick={() => {
                const command = pending;
                setPending(null);
                void execute(command);
              }}
            >
              Run
            </button>
            <button
              type="button"
              className="cr-palette__confirm-btn"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="cr-palette__error" role="alert">
            <Icon name="warning" size={14} />
            <span>{error}</span>
          </div>
        )}

        <footer className="cr-palette__footer">
          <span className="cr-palette__hints">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> run
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
          </span>
          <span className="cr-palette__count">
            {flat.length} command{flat.length === 1 ? "" : "s"}
          </span>
        </footer>
      </div>
    </div>
  );
}
