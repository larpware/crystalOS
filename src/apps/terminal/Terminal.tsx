import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useFsStore } from "@/state/fs";
import { useSystemStore } from "@/state/system";
import { loadJSON, saveJSON } from "@/services/storage";
import { SYSTEM_VERSION } from "@/version";
import {
  commandNames,
  completePath,
  describeCwd,
  findCommand,
  tokenize,
  type CommandContext,
  type OutputLine,
} from "./commands";
import type { AppProps } from "@/types";

/* ==========================================================================
   CrystalOS Terminal
   ========================================================================== */

const HISTORY_KEY = "terminal-history";

interface RenderLine extends OutputLine {
  id: number;
  /** Echoed command lines are styled differently from output. */
  prompt?: string;
}

let lineCounter = 0;

export function Terminal({ windowId, args }: AppProps) {
  const nodes = useFsStore((state) => state.nodes);
  const performanceMode = useSystemStore((state) => state.performanceMode);

  const [cwd, setCwd] = useState(() => useFsStore.getState().lastVisitedId);
  const [lines, setLines] = useState<RenderLine[]>(() => [
    { id: lineCounter++, text: `CrystalOS Terminal ${SYSTEM_VERSION.version} — type "help" for commands.`, tone: "muted" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadJSON<string[]>(HISTORY_KEY, []));
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [completion, setCompletion] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useMemo(() => describeCwd(cwd), [cwd, nodes]);

  const print = useCallback((...next: (string | OutputLine)[]) => {
    setLines((current) => [
      ...current,
      ...next.map((entry) =>
        typeof entry === "string"
          ? { id: lineCounter++, text: entry }
          : { id: lineCounter++, ...entry },
      ),
    ]);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  const clear = useCallback(() => setLines([]), []);

  const runCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      setLines((current) => [
        ...current,
        { id: lineCounter++, text: trimmed, prompt, tone: "default" },
      ]);

      const nextHistory = [...history.filter((entry) => entry !== trimmed), trimmed].slice(-100);
      setHistory(nextHistory);
      saveJSON(HISTORY_KEY, nextHistory);
      setHistoryIndex(null);
      setCompletion([]);

      const [name, ...args] = tokenize(trimmed);
      const command = findCommand(name);

      if (!command) {
        print(
          { text: `crystal-sh: ${name}: command not found`, tone: "error" },
          { text: 'Type "help" to list available commands.', tone: "muted" },
        );
        return;
      }

      const context: CommandContext = {
        cwd,
        setCwd: (id) => {
          setCwd(id);
          useFsStore.getState().setLastVisited(id);
        },
        print,
        clear,
        history: nextHistory,
      };

      setBusy(true);
      try {
        await command.run(args, context);
      } catch (error) {
        print({
          text: `crystal-sh: ${command.name} failed: ${error instanceof Error ? error.message : "unknown error"}`,
          tone: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [cwd, history, print, prompt, clear],
  );

  /*
   * `openNode` and the desktop context menu launch the Terminal with a
   * starting folder and a command, e.g. listing a folder's contents. The
   * command runs through the real parser, so it appears in the history and
   * behaves exactly as if it had been typed.
   */
  const startupRef = useRef<{ cwd: string | null; run: string | null } | null>(
    typeof args?.cwd === "string" || typeof args?.run === "string"
      ? {
          cwd: typeof args?.cwd === "string" ? args.cwd : null,
          run: typeof args?.run === "string" ? args.run : null,
        }
      : null,
  );
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  useEffect(() => {
    const startup = startupRef.current;
    if (!startup) return;
    startupRef.current = null;
    if (startup.cwd && useFsStore.getState().nodes.some((node) => node.id === startup.cwd)) {
      setCwd(startup.cwd);
      useFsStore.getState().setLastVisited(startup.cwd);
    }
    if (startup.run) setPendingCommand(startup.run);
  }, []);

  /* Runs after the starting folder is applied, so `ls` lists the right one. */
  useEffect(() => {
    if (!pendingCommand) return;
    setPendingCommand(null);
    void runCommand(pendingCommand);
  }, [pendingCommand, runCommand]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        void runCommand(input);
        setInput("");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (history.length === 0) return;
        const nextIndex = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (historyIndex === null) return;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) {
          setHistoryIndex(null);
          setInput("");
          return;
        }
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const parts = input.split(/\s+/);
        const fragment = parts[parts.length - 1] ?? "";

        if (parts.length <= 1) {
          const matches = commandNames.filter((name) => name.startsWith(fragment));
          if (matches.length === 1) {
            setInput(`${matches[0]} `);
            setCompletion([]);
          } else if (matches.length > 1) {
            setCompletion(matches);
            // Complete to the longest shared prefix.
            let prefix = matches[0];
            for (const match of matches) {
              while (!match.startsWith(prefix)) prefix = prefix.slice(0, -1);
            }
            setInput(prefix);
          } else {
            setCompletion([]);
          }
          return;
        }

        const pathMatches = completePath(cwd, fragment);
        if (pathMatches.length === 1) {
          parts[parts.length - 1] = pathMatches[0];
          setInput(parts.join(" "));
          setCompletion([]);
        } else if (pathMatches.length > 1) {
          setCompletion(pathMatches);
        } else {
          setCompletion([]);
        }
        return;
      }

      if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        clear();
        return;
      }

      if (event.key === "c" && event.ctrlKey) {
        event.preventDefault();
        setInput("");
        setLines((current) => [
          ...current,
          { id: lineCounter++, text: `${prompt} ${input}^C`, tone: "muted" },
        ]);
      }
    },
    [clear, cwd, history, historyIndex, input, prompt, runCommand],
  );

  // Expose the window id on the root so the shell can address this instance.
  return (
    <div
      className="cr-term"
      data-window={windowId}
      onClick={() => inputRef.current?.focus()}
      role="application"
      aria-label="CrystalOS Terminal"
    >
      <div className="cr-term__scroll" ref={scrollRef}>
        {lines.map((entry) => (
          <div key={entry.id} className="cr-term__line" data-tone={entry.tone ?? "default"}>
            {entry.prompt && (
              <>
                <span className="cr-term__prompt">{entry.prompt}</span>
                <span className="cr-term__caret">$</span>{" "}
              </>
            )}
            {entry.text}
          </div>
        ))}
        {busy && <div className="cr-term__line" data-tone="muted">…</div>}
      </div>

      {completion.length > 0 && (
        <div className="cr-term__completion">
          {completion.slice(0, 14).map((candidate) => (
            <span key={candidate}>{candidate}</span>
          ))}
        </div>
      )}

      <div className="cr-term__input-row">
        <span className="cr-term__prompt">{prompt}</span>
        <span className="cr-term__caret">$</span>
        <input
          ref={inputRef}
          className="cr-term__input cr-mono"
          value={input}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Terminal input"
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder=""
        />
      </div>
      {!performanceMode && (
        <div className="cr-term__hint">
          Tab completes · ↑ ↓ history · Ctrl+L clears · Ctrl+C cancels
        </div>
      )}
    </div>
  );
}
