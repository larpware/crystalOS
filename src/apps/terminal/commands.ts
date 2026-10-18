import {
  childrenOf,
  descendantSize,
  homeNodeId,
  pathString,
  resolvePath,
  ROOT_ID,
  useFsStore,
} from "@/state/fs";
import { useAppearanceStore } from "@/state/appearance";
import { useNotificationStore } from "@/state/notifications";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useWindowStore } from "@/state/windows";
import { useAuthStore } from "@/state/auth";
import { useBrowserStore } from "@/state/browser";
import { useAppsStore } from "@/state/apps";
import { appCatalog } from "@/apps/catalog";
import { APP_CATEGORY_LABEL } from "@/types";
import {
  appSource,
  capabilityLabels,
  isRemovable,
  resolveApp,
  searchApps,
  staleInstalled,
  type AppResolution,
} from "./installs";
import { openApp, openNode } from "@/services/os";
import { getScramjetState } from "@/services/scramjet";
import {
  deviceMemoryGb,
  estimateStorage,
  logicalProcessors,
  measureRefreshRate,
  readNetwork,
} from "@/services/system";
import { byteSize, isPersistenceAvailable, listKeys } from "@/services/storage";
import { builtInWallpapers, gradientWallpapers, liveWallpapers } from "@/wallpapers/library";
import { listCustomWallpapers } from "@/wallpapers/custom";
import { formatBytes, formatClockDuration } from "@/utils/format";
import { SYSTEM_VERSION } from "@/version";

/* ==========================================================================
   Terminal commands

   Every command operates on real state. `df` reports storage the OS actually
   measures, `neofetch` reports the actual viewport and refresh rate, `ls`
   reads the real virtual filesystem. Commands that cannot work in a browser
   are absent rather than simulated.
   ========================================================================== */

export type LineTone = "default" | "muted" | "accent" | "success" | "error" | "heading";

export interface OutputLine {
  text: string;
  tone?: LineTone;
  /** Rendered without a trailing newline grouping. */
  pre?: boolean;
}

/** One-line proxy summary built from the shared Scramjet service's state. */
function describeProxyState(
  status: "idle" | "loading" | "ready" | "error",
  transport: string | null,
  error: string | null,
): string {
  if (status === "ready") return `Scramjet ready${transport ? ` · ${transport}` : ""}`;
  if (status === "error") return `offline — ${error ?? "backend unreachable"}`;
  if (status === "loading") return "starting";
  return "not started yet";
}

export interface CommandContext {
  /** Current working directory node id. */
  cwd: string;
  setCwd: (id: string) => void;
  print: (...lines: (string | OutputLine)[]) => void;
  clear: () => void;
  history: string[];
}

export interface CommandDefinition {
  name: string;
  summary: string;
  usage?: string;
  group: "files" | "system" | "store" | "shell" | "help";
  run: (args: string[], ctx: CommandContext) => void | Promise<void>;
}

function line(text: string, tone: LineTone = "default"): OutputLine {
  return { text, tone };
}

/**
 * Splits a command line into arguments the way a shell does: whitespace
 * separates, but single or double quotes keep a name with spaces together, so
 * `rm ~/Music/"test tone.wav"` addresses one file.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

function resolveArg(ctx: CommandContext, rawTarget: string): string | null {
  if (!rawTarget || rawTarget === ".") return ctx.cwd;
  const nodes = useFsStore.getState().nodes;
  if (rawTarget === "~" || rawTarget === "home") return homeNodeId(nodes);
  if (rawTarget === "/") return ROOT_ID;
  // `~/Documents/Notes` has to resolve like `/Home/Documents/Notes`: the prompt
  // prints the home folder as `~`, so the shell accepts it in arguments too.
  const target = rawTarget.startsWith("~/")
    ? `${pathString(nodes, homeNodeId(nodes))}${rawTarget.slice(1)}`
    : rawTarget;
  if (target.startsWith("/")) return resolvePath(nodes, target);

  let cursor = ctx.cwd;
  for (const segment of target.split("/").filter(Boolean)) {
    if (segment === "..") {
      const node = nodes.find((candidate) => candidate.id === cursor);
      cursor = node?.parentId ?? cursor;
      continue;
    }
    const child = nodes.find(
      (node) => node.parentId === cursor && !node.trashed && node.name.toLowerCase() === segment.toLowerCase(),
    );
    if (!child) return null;
    cursor = child.id;
  }
  return cursor;
}

function shortPath(id: string): string {
  const nodes = useFsStore.getState().nodes;
  const full = pathString(nodes, id);
  const home = pathString(nodes, homeNodeId(nodes));
  return home !== "/" && full.startsWith(home) ? `~${full.slice(home.length)}` || "~" : full;
}

/* ---- application install helpers ---------------------------------------- */

/** Catalogue ids the user has explicitly enabled, i.e. installed minus removed. */
function enabledAppIds(): Set<string> {
  const store = useAppsStore.getState();
  const removed = new Set(store.removed);
  return new Set(store.installed.map((entry) => entry.appId).filter((id) => !removed.has(id)));
}

/** Prints what a package is before anything is enabled: the store's own metadata. */
function describeApp(ctx: CommandContext, meta: (typeof appCatalog)[number]): void {
  ctx.print(line(meta.name, "heading"));
  ctx.print(line(`  id           ${meta.id}`));
  ctx.print(line(`  version      ${meta.version}`));
  ctx.print(line(`  category     ${APP_CATEGORY_LABEL[meta.category]}`));
  ctx.print(line(`  source       ${appSource(meta)}`));
  ctx.print(line(`  permissions  ${capabilityLabels(meta).join(", ") || "none declared"}`));
}

/**
 * The refusal for a native program. It names the program, says why CrystalOS
 * cannot install it, and only mentions a CrystalOS application when one covers
 * some of the same ground — phrased so it is never mistaken for the program the
 * user asked for.
 */
function refuseNative(ctx: CommandContext, resolution: Extract<AppResolution, { kind: "native" }>): void {
  ctx.print(line(`${resolution.label} is ${resolution.reason}, not a CrystalOS application.`, "error"));
  if (resolution.closest) {
    ctx.print(
      line(
        `  CrystalOS ships ${resolution.closest.name}, which covers some of the same ground. It is CrystalOS's own application, not ${resolution.label}.`,
        "muted",
      ),
    );
  }
  ctx.print(
    line(
      "  CrystalOS is a web OS: it enables the web applications bundled with this build. It cannot install Windows software.",
      "muted",
    ),
  );
}

export const commands: CommandDefinition[] = [
  /* ---- help ------------------------------------------------------------ */
  {
    name: "help",
    summary: "List every command, or describe one in detail.",
    usage: "help [command]",
    group: "help",
    run: (args, ctx) => {
      if (args[0]) {
        const command = commands.find((candidate) => candidate.name === args[0]);
        if (!command) {
          ctx.print(line(`No such command: ${args[0]}`, "error"));
          return;
        }
        ctx.print(line(command.name, "heading"));
        ctx.print(line(`  ${command.summary}`));
        if (command.usage) ctx.print(line(`  usage: ${command.usage}`, "muted"));
        return;
      }
      const groups: Record<CommandDefinition["group"], string> = {
        files: "Filesystem",
        system: "System",
        store: "Applications",
        shell: "Shell",
        help: "Help",
      };
      for (const group of ["files", "system", "store", "shell", "help"] as const) {
        const list = commands.filter((command) => command.group === group);
        if (list.length === 0) continue;
        ctx.print(line(groups[group], "heading"));
        for (const command of list) {
          ctx.print(line(`  ${command.name.padEnd(11)} ${command.summary}`, "muted"));
        }
      }
    },
  },
  {
    name: "neofetch",
    summary: "Report the actual runtime, display and OS state.",
    group: "system",
    run: async (_args, ctx) => {
      const appearance = useAppearanceStore.getState();
      const system = useSystemStore.getState();
      const windows = useWindowStore.getState().windows;
      const nodes = useFsStore.getState().nodes;
      const refresh = await measureRefreshRate();
      const timing = refresh ? `${refresh.hz} Hz (${refresh.frameMs} ms)` : "unavailable";

      const rows: [string, string][] = [
        ["OS", `CrystalOS ${SYSTEM_VERSION.version} (${SYSTEM_VERSION.codename})`],
        ["Build", SYSTEM_VERSION.build],
        ["Host", window.navigator.userAgent.includes("Windows") ? "Windows host" : "Browser host"],
        ["Shell", "crystal-sh 1.2"],
        ["Theme", `${appearance.themeId} · accent ${appearance.accentId}`],
        ["Motion", system.motionOverride],
        ["Display", `${window.innerWidth}×${window.innerHeight} @ ${timing}`],
        ["Renderer", deviceMemoryGb() ? `${deviceMemoryGb()} GB device memory` : "device memory unavailable"],
        ["Threads", logicalProcessors() ? String(logicalProcessors()) : "unavailable"],
        ["Windows", String(windows.length)],
        ["Filesystem", `${nodes.filter((node) => !node.trashed).length} entries`],
        ["Persistence", isPersistenceAvailable() ? "localStorage + IndexedDB" : "memory only"],
      ];

      const glyph = [
        "   .---.   ",
        "  /     \\  ",
        " | () () | ",
        "  \\  ^  /  ",
        "   '---'   ",
      ];
      const width = Math.max(...rows.map(([key]) => key.length));
      rows.forEach(([key, value], index) => {
        const art = glyph[index] ?? "           ";
        ctx.print(line(`${art}  ${key.padEnd(width)}  ${value}`, index === 0 ? "accent" : "default"));
      });
      ctx.print(line(""));
      ctx.print(
        line(
          "CrystalOS runs in this browser profile. Nothing above is estimated — unavailable values are labelled.",
          "muted",
        ),
      );
    },
  },
  {
    name: "df",
    summary: "Show measured storage used by CrystalOS.",
    group: "system",
    run: async (_args, ctx) => {
      const keys = listKeys();
      const local = byteSize();
      const estimate = await estimateStorage();
      ctx.print(line("filesystem      used", "heading"));
      ctx.print(line(`crystal-local  ${formatBytes(local)} across ${keys.length} keys`));
      if (estimate) {
        ctx.print(line(`browser-quota   ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`));
      } else {
        ctx.print(line("browser-quota   unavailable in this browser", "muted"));
      }
      const nodes = useFsStore.getState().nodes;
      ctx.print(line(`virtual-disk    ${nodes.length} entries`));
    },
  },
  {
    name: "uptime",
    summary: "Report how long this session has been running.",
    group: "system",
    run: (_args, ctx) => {
      const started = useSystemStore.getState().sessionStartedAt;
      const elapsed = Date.now() - started;
      const windows = useWindowStore.getState().windows.length;
      ctx.print(line(`up ${formatClockDuration(elapsed)} · ${windows} window${windows === 1 ? "" : "s"} open`));
    },
  },
  {
    name: "hz",
    summary: "Measure the display refresh rate.",
    group: "system",
    run: async (_args, ctx) => {
      ctx.print(line("Measuring with requestAnimationFrame…", "muted"));
      const result = await measureRefreshRate();
      if (!result) {
        ctx.print(line("Could not measure display timing in this context.", "error"));
        return;
      }
      ctx.print(line(`Display refresh: ${result.hz} Hz (median frame ${result.frameMs} ms)`, "success"));
      ctx.print(line("Enable the ongoing counter in Settings → Appearance → Refresh rate.", "muted"));
    },
  },
  {
    name: "net",
    summary: "Show the browser's real network status.",
    group: "system",
    run: (_args, ctx) => {
      const network = readNetwork();
      const proxy = getScramjetState();
      ctx.print(line(`Connection   ${network.online ? "online" : "offline"}`));
      ctx.print(line(`Effective    ${network.effectiveType ?? "unavailable"}`));
      ctx.print(line(`Downlink     ${network.downlinkMbps != null ? `${network.downlinkMbps} Mb/s` : "unavailable"}`));
      ctx.print(line(`Latency      ${network.rttMs != null ? `${network.rttMs} ms (browser estimate)` : "unavailable"}`));
      ctx.print(line(`Data saver   ${network.saveData ? "on" : "off"}`));
      ctx.print(
        line(
          `Proxy        ${describeProxyState(proxy.status, proxy.transport, proxy.error)}`,
          proxy.status === "error" ? "error" : "default",
        ),
      );
    },
  },

  /* ---- filesystem ------------------------------------------------------ */
  {
    name: "pwd",
    summary: "Print the working directory.",
    group: "files",
    run: (_args, ctx) => ctx.print(line(shortPath(ctx.cwd))),
  },
  {
    name: "ls",
    summary: "List directory contents.",
    usage: "ls [-l] [path]",
    group: "files",
    run: (args, ctx) => {
      const long = args.includes("-l");
      const target = args.find((arg) => !arg.startsWith("-"));
      const id = resolveArg(ctx, target ?? ".");
      if (!id) {
        ctx.print(line(`ls: cannot access '${target}': No such entry`, "error"));
        return;
      }
      const nodes = useFsStore.getState().nodes;
      const node = nodes.find((candidate) => candidate.id === id);
      if (!node) return;
      if (node.kind === "file") {
        ctx.print(line(`${node.name}  ${formatBytes(node.size)}`));
        return;
      }
      const children = childrenOf(nodes, id);
      if (children.length === 0) {
        ctx.print(line("(empty)", "muted"));
        return;
      }
      if (long) {
        for (const child of children) {
          const kind = child.kind === "folder" ? "d" : "-";
          const size = child.kind === "folder" ? descendantSize(nodes, child.id) : child.size;
          const when = new Date(child.modified).toISOString().slice(0, 16).replace("T", " ");
          ctx.print(
            line(
              `${kind}  ${String(formatBytes(size)).padStart(9)}  ${when}  ${child.name}${child.kind === "folder" ? "/" : ""}`,
            ),
          );
        }
        return;
      }
      const parts = children.map((child) => (child.kind === "folder" ? `${child.name}/` : child.name));
      const lines: string[][] = [];
      for (let index = 0; index < parts.length; index += 4) lines.push(parts.slice(index, index + 4));
      for (const row of lines) ctx.print(line(row.map((part) => part.padEnd(24)).join("").trimEnd()));
    },
  },
  {
    name: "cd",
    summary: "Change the working directory.",
    usage: "cd <path>",
    group: "files",
    run: (args, ctx) => {
      const id = resolveArg(ctx, args[0] ?? "~");
      if (!id) {
        ctx.print(line(`cd: no such directory: ${args[0]}`, "error"));
        return;
      }
      const node = useFsStore.getState().nodes.find((candidate) => candidate.id === id);
      if (!node || node.kind !== "folder") {
        ctx.print(line(`cd: not a directory: ${args[0]}`, "error"));
        return;
      }
      ctx.setCwd(id);
    },
  },
  {
    name: "cat",
    summary: "Print a text file.",
    usage: "cat <file>",
    group: "files",
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.print(line("cat: missing file operand", "error"));
        return;
      }
      const id = resolveArg(ctx, args[0]);
      const node = id ? useFsStore.getState().nodes.find((candidate) => candidate.id === id) : undefined;
      if (!node || node.kind !== "file") {
        ctx.print(line(`cat: ${args[0]}: No such file`, "error"));
        return;
      }
      if (!node.content) {
        ctx.print(
          line(
            `cat: ${node.name}: binary or imported file (${formatBytes(node.size)}). Open it from the desktop or with 'open'.`,
            "muted",
          ),
        );
        return;
      }
      for (const contentLine of node.content.split("\n")) ctx.print(line(contentLine));
    },
  },
  {
    name: "mkdir",
    summary: "Create a directory.",
    usage: "mkdir <name>",
    group: "files",
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.print(line("mkdir: missing operand", "error"));
        return;
      }
      const name = args.join(" ");
      const id = useFsStore.getState().createFolder(ctx.cwd, name);
      ctx.print(line(`created ${shortPath(id)}`, "success"));
    },
  },
  {
    name: "touch",
    summary: "Create an empty text file.",
    usage: "touch <name>",
    group: "files",
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.print(line("touch: missing operand", "error"));
        return;
      }
      const name = args[0].includes(".") ? args[0] : `${args[0]}.txt`;
      const id = useFsStore.getState().createFile(ctx.cwd, name, "");
      ctx.print(line(`created ${shortPath(id)}`, "success"));
    },
  },
  {
    name: "write",
    summary: "Write text into a file, replacing its contents.",
    usage: "write <file> <text>",
    group: "files",
    run: (args, ctx) => {
      const [target, ...rest] = args;
      if (!target || rest.length === 0) {
        ctx.print(line("write: usage write <file> <text>", "error"));
        return;
      }
      const nodes = useFsStore.getState().nodes;
      const id = resolveArg(ctx, target);
      const node = id ? nodes.find((candidate) => candidate.id === id) : undefined;
      const text = rest.join(" ");
      if (!node) {
        useFsStore.getState().createFile(ctx.cwd, target, text);
        ctx.print(line(`created ${target}`, "success"));
        return;
      }
      if (node.kind !== "file") {
        ctx.print(line(`write: ${target} is a directory`, "error"));
        return;
      }
      useFsStore.getState().setContent(node.id, text);
      ctx.print(line(`wrote ${text.length} characters to ${node.name}`, "success"));
    },
  },
  {
    name: "rm",
    summary: "Move an entry to Trash.",
    usage: "rm <path>",
    group: "files",
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.print(line("rm: missing operand", "error"));
        return;
      }
      const id = resolveArg(ctx, args[0]);
      const node = id ? useFsStore.getState().nodes.find((candidate) => candidate.id === id) : undefined;
      if (!node || node.id === ROOT_ID) {
        ctx.print(line(`rm: ${args[0]}: No such entry`, "error"));
        return;
      }
      if (node.readonly) {
        ctx.print(line(`rm: ${node.name}: read-only`, "error"));
        return;
      }
      useFsStore.getState().trashMany([node.id]);
      ctx.print(line(`moved ${node.name} to Trash`, "success"));
    },
  },
  {
    name: "tree",
    summary: "Print the directory tree below a path.",
    usage: "tree [path] [depth]",
    group: "files",
    run: (args, ctx) => {
      const pathArg = args.find((arg) => !/^\d+$/.test(arg));
      const depthArg = args.find((arg) => /^\d+$/.test(arg));
      const maxDepth = depthArg ? Number(depthArg) : 3;
      const id = resolveArg(ctx, pathArg ?? ".");
      if (!id) {
        ctx.print(line(`tree: cannot access '${pathArg}'`, "error"));
        return;
      }
      const nodes = useFsStore.getState().nodes;
      let count = 0;
      const walk = (parentId: string, depth: number, prefix: string) => {
        if (depth > maxDepth) return;
        const children = childrenOf(nodes, parentId);
        children.forEach((child, index) => {
          const last = index === children.length - 1;
          const connector = last ? "└── " : "├── ";
          ctx.print(line(`${prefix}${connector}${child.name}${child.kind === "folder" ? "/" : ""}`));
          count += 1;
          if (child.kind === "folder") {
            walk(child.id, depth + 1, `${prefix}${last ? "    " : "│   "}`);
          }
        });
      };
      ctx.print(line(shortPath(id), "accent"));
      walk(id, 1, "");
      ctx.print(line(`\n${count} entries`, "muted"));
    },
  },

  /* ---- shell ----------------------------------------------------------- */
  {
    name: "open",
    summary: "Open an application, a path or a URL.",
    usage: "open <app|path|url> [args]",
    group: "shell",
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.print(line("open: usage open <app|path|url>", "error"));
        return;
      }
      const [target, ...rest] = args;
      const value = rest.join(" ");

      if (target === "wallpapers") {
        openApp("wallpaper");
        ctx.print(line("opened Wallpaper Library", "success"));
        return;
      }

      if (appCatalog.some((app) => app.id === target)) {
        const extra = rest.length > 0 ? { path: rest.join(" ") } : undefined;
        openApp(target, extra ? { args: extra } : {});
        ctx.print(line(`launched ${target}`, "success"));
        return;
      }

      if (/^https?:\/\//.test(target) || (rest.length === 0 && target.includes("."))) {
        const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
        const tabId = useBrowserStore.getState().newTab(url, true);
        openApp("browser", { args: { tabId } });
        ctx.print(line(`opened ${url}`, "success"));
        return;
      }

      const id = resolveArg(ctx, [target, value].filter(Boolean).join("/"));
      if (id) {
        openNode(id);
        ctx.print(line(`opened ${shortPath(id)}`, "success"));
        return;
      }

      ctx.print(line(`open: nothing matches '${target}'`, "error"));
    },
  },
  {
    name: "apps",
    summary: "List every application in the catalogue.",
    group: "shell",
    run: (_args, ctx) => {
      ctx.print(line("Applications in this build", "heading"));
      for (const app of appCatalog) {
        ctx.print(line(`  ${app.id.padEnd(12)} ${app.name}`, "muted"));
      }
      ctx.print(line(`\n${appCatalog.length} applications. Launch one with: open <id>`, "muted"));
      ctx.print(line("Enable or disable one with: install <id> / remove <id>", "muted"));
    },
  },
  {
    name: "wallpapers",
    summary: "List wallpapers and apply one by id.",
    usage: "wallpapers [id]",
    group: "shell",
    run: (args, ctx) => {
      const all = [...builtInWallpapers, ...gradientWallpapers, ...liveWallpapers];
      const custom = listCustomWallpapers();
      if (args[0]) {
        const target = all.find((wallpaper) => wallpaper.id === args[0]);
        const customTarget = custom.find((record) => record.id === args[0]);
        if (!target && !customTarget) {
          ctx.print(line(`wallpapers: no wallpaper with id '${args[0]}'`, "error"));
          return;
        }
        const appearance = useAppearanceStore.getState();
        appearance.setWallpaper(
          appearance.wallpaper.syncLock
            ? { desktopId: args[0], lockId: args[0] }
            : { desktopId: args[0] },
        );
        ctx.print(line(`applied ${target?.name ?? customTarget?.name}`, "success"));
        return;
      }
      ctx.print(line(`Built-in (${all.length})`, "heading"));
      for (const wallpaper of all) {
        ctx.print(line(`  ${wallpaper.id.padEnd(20)} ${wallpaper.kind.padEnd(9)} ${wallpaper.name}`, "muted"));
      }
      if (custom.length > 0) {
        ctx.print(line(`\nImported (${custom.length})`, "heading"));
        for (const record of custom) {
          ctx.print(line(`  ${record.id.padEnd(20)} ${record.kind.padEnd(9)} ${record.name}`, "muted"));
        }
      }
      ctx.print(line("\nApply with: wallpapers <id>", "muted"));
    },
  },
  {
    name: "set",
    summary: "Change an OS setting from the shell.",
    usage: "set theme|accent|motion|scale|wallpaper|dnd|performance <value>",
    group: "shell",
    run: (args, ctx) => {
      const [key, ...rest] = args;
      const value = rest.join(" ");
      const appearance = useAppearanceStore.getState();
      const system = useSystemStore.getState();
      const notifications = useNotificationStore.getState();

      switch (key) {
        case "theme": {
          if (!value) {
            ctx.print(line(`theme is ${appearance.themeId}`, "muted"));
            return;
          }
          appearance.setTheme(value);
          ctx.print(line(`theme set to ${value}`, "success"));
          return;
        }
        case "accent":
          if (!value) {
            ctx.print(line(`accent is ${appearance.accentId}`, "muted"));
            return;
          }
          appearance.setAccent(value);
          ctx.print(line(`accent set to ${value}`, "success"));
          return;
        case "motion":
          if (value !== "system" && value !== "full" && value !== "subtle" && value !== "reduced") {
            ctx.print(line("set: motion expects system, full, subtle or reduced", "error"));
            return;
          }
          system.setMotionOverride(value);
          ctx.print(line(`motion set to ${value}`, "success"));
          return;
        case "scale": {
          const scale = Number(value);
          if (!Number.isFinite(scale) || scale < 0.75 || scale > 2) {
            ctx.print(line("set: scale expects a number between 0.75 and 2", "error"));
            return;
          }
          appearance.setOsScale(scale);
          ctx.print(line(`UI scale set to ${scale}`, "success"));
          return;
        }
        case "wallpaper":
          commands.find((command) => command.name === "wallpapers")!.run([value], ctx);
          return;
        case "dnd": {
          const next = value === "on" ? true : value === "off" ? false : !notifications.prefs.doNotDisturb;
          notifications.setPrefs({ doNotDisturb: next });
          ctx.print(line(`Do Not Disturb ${next ? "enabled" : "disabled"}`, "success"));
          return;
        }
        case "performance": {
          const next = value === "on" ? true : value === "off" ? false : !system.performanceMode;
          system.setPerformanceMode(next);
          ctx.print(line(`Performance mode ${next ? "enabled" : "disabled"}`, "success"));
          return;
        }
        default:
          ctx.print(line(`set: unknown key '${key ?? ""}'. Try theme, accent, motion, scale, wallpaper, dnd or performance.`, "error"));
      }
    },
  },
  {
    name: "notify",
    summary: "Send a desktop notification.",
    usage: "notify <title> | <body>",
    group: "shell",
    run: (args, ctx) => {
      if (args.length === 0) {
        ctx.print(line("notify: give the notification some text", "error"));
        return;
      }
      const [title, body] = args.join(" ").split("|");
      useNotificationStore.getState().notify({
        appId: "terminal",
        icon: "terminal",
        title: title.trim() || "Terminal",
        body: body?.trim(),
      });
      ctx.print(line("notification sent", "success"));
    },
  },
  {
    name: "lock",
    summary: "Lock the session.",
    group: "shell",
    run: (_args, ctx) => {
      ctx.print(line("Locking…", "muted"));
      useShellStore.getState().setPowerState("locked");
    },
  },
  {
    name: "windows",
    summary: "List open windows and focus one by index.",
    usage: "windows [index]",
    group: "shell",
    run: (args, ctx) => {
      const store = useWindowStore.getState();
      const list = store.windows;
      if (list.length === 0) {
        ctx.print(line("No windows are open.", "muted"));
        return;
      }
      if (args[0]) {
        const index = Number(args[0]);
        const target = list[index - 1];
        if (!target) {
          ctx.print(line(`windows: no window ${args[0]}`, "error"));
          return;
        }
        store.focus(target.id);
        ctx.print(line(`focused ${target.title}`, "success"));
        return;
      }
      list.forEach((window, index) => {
        const flags = [window.minimized ? "minimized" : null, window.focused ? "focused" : null]
          .filter(Boolean)
          .join(", ");
        ctx.print(
          line(`  ${index + 1}. ${window.title.padEnd(24)} ${flags}`, window.focused ? "accent" : "muted"),
        );
      });
    },
  },
  {
    name: "whoami",
    summary: "Print the signed-in profile.",
    group: "system",
    run: (_args, ctx) => {
      const auth = useAuthStore.getState();
      if (!auth.account) {
        ctx.print(line("no session", "muted"));
        return;
      }
      ctx.print(line(auth.account.displayName));
      ctx.print(line(`  username   ${auth.account.username}`));
      ctx.print(line(`  friend code ${auth.account.friendCode}`));
      ctx.print(line(`  mode       ${auth.mode === "guest" ? "guest (local only)" : "local account"}`));
    },
  },
  {
    name: "echo",
    summary: "Print text back.",
    group: "shell",
    run: (args, ctx) => ctx.print(line(args.join(" "))),
  },
  {
    name: "date",
    summary: "Print the current date and time.",
    group: "system",
    run: (_args, ctx) => ctx.print(line(new Date().toString())),
  },
  {
    name: "history",
    summary: "Show command history.",
    group: "shell",
    run: (_args, ctx) => {
      ctx.history.forEach((entry, index) => {
        ctx.print(line(`  ${String(index + 1).padStart(3)}  ${entry}`, "muted"));
      });
    },
  },
  {
    name: "clear",
    summary: "Clear the terminal.",
    group: "shell",
    run: (_args, ctx) => ctx.clear(),
  },

  /* ---- applications ---------------------------------------------------- */
  {
    name: "search",
    summary: "Search the application catalogue.",
    usage: "search <term>",
    group: "store",
    run: (args, ctx) => {
      const term = args.join(" ").trim();
      if (!term) {
        ctx.print(line("search: what are you looking for?", "error"));
        ctx.print(line("  search games · search notes · search internet", "muted"));
        return;
      }
      const results = searchApps(term);
      if (results.length === 0) {
        const resolution = resolveApp(term);
        if (resolution.kind === "native") {
          refuseNative(ctx, resolution);
          return;
        }
        ctx.print(line(`Nothing in the catalogue matches '${term}'.`, "muted"));
        ctx.print(line("  List everything with: list available", "muted"));
        return;
      }
      const enabled = enabledAppIds();
      ctx.print(
        line(`${results.length} match${results.length === 1 ? "" : "es"} for '${term}'`, "heading"),
      );
      for (const meta of results) {
        ctx.print(
          line(
            `  ${meta.id.padEnd(12)} ${meta.name}${enabled.has(meta.id) ? "  ·  enabled" : ""}`,
            enabled.has(meta.id) ? "accent" : "muted",
          ),
        );
        ctx.print(line(`               ${meta.summary}`, "muted"));
      }
      ctx.print(line("Details and install: install <id>", "muted"));
    },
  },
  {
    name: "install",
    summary: "Show an application's details and enable it.",
    usage: "install <app>",
    group: "store",
    run: (args, ctx) => {
      const term = args.join(" ").trim();
      if (!term) {
        ctx.print(line("install: which application?", "error"));
        ctx.print(line("  e.g. install notes · install calc · search <term>", "muted"));
        return;
      }

      const resolution = resolveApp(term);
      if (resolution.kind === "unknown") {
        ctx.print(line(`install: no application called '${term}'.`, "error"));
        ctx.print(line("  Find the right name with: search <term>", "muted"));
        return;
      }
      if (resolution.kind === "native") {
        refuseNative(ctx, resolution);
        return;
      }

      const { meta } = resolution;
      describeApp(ctx, meta);
      if (resolution.matchedBy === "alias" && resolution.alias) {
        ctx.print(line(`  matched      '${resolution.alias}' is another name for ${meta.id}`, "muted"));
      }

      /* A system application is not a package: it is part of the build and the
         Store never lists it for install or removal. Saying so is more useful
         than pretending to install it again. */
      if (!isRemovable(meta)) {
        ctx.print(line(`${meta.name} is a system application and is always available.`, "success"));
        ctx.print(line(`  Launch it with: open ${meta.id}`, "muted"));
        return;
      }

      if (enabledAppIds().has(meta.id)) {
        ctx.print(line(`${meta.name} is already enabled.`, "success"));
        ctx.print(line(`  Launch it with: open ${meta.id}`, "muted"));
        return;
      }

      useAppsStore.getState().install(meta.id, meta.version);
      ctx.print(line(`enabled ${meta.name} ${meta.version}`, "success"));
      ctx.print(
        line(
          "  Nothing was downloaded: the application was already in this build, and installing records that it is enabled.",
          "muted",
        ),
      );
    },
  },
  {
    name: "remove",
    summary: "Disable an optional application.",
    usage: "remove <app>",
    group: "store",
    run: (args, ctx) => {
      const term = args.join(" ").trim();
      if (!term) {
        ctx.print(line("remove: which application?", "error"));
        return;
      }

      const resolution = resolveApp(term);
      if (resolution.kind === "unknown") {
        ctx.print(line(`remove: no application called '${term}'.`, "error"));
        return;
      }
      if (resolution.kind === "native") {
        refuseNative(ctx, resolution);
        return;
      }

      const { meta } = resolution;
      if (!isRemovable(meta)) {
        ctx.print(line(`${meta.name} is a system application and cannot be removed.`, "error"));
        ctx.print(line("  CrystalOS has no mechanism to remove it, so there is nothing to do.", "muted"));
        return;
      }
      if (!enabledAppIds().has(meta.id)) {
        ctx.print(line(`${meta.name} is not enabled, so there is nothing to remove.`, "muted"));
        return;
      }

      useAppsStore.getState().remove(meta.id);
      ctx.print(line(`disabled ${meta.name}`, "success"));

      const open = useWindowStore.getState().windows.filter((window) => window.appId === meta.id);
      if (open.length > 0) {
        ctx.print(
          line(
            `  ${open.length} open window${open.length === 1 ? "" : "s"} stay open until you close ${open.length === 1 ? "it" : "them"}.`,
            "muted",
          ),
        );
      }
      ctx.print(
        line(
          "  The code stays in this build — CrystalOS is a web OS and disabling an application hides it. Re-enable it with: install " +
            meta.id,
          "muted",
        ),
      );
    },
  },
  {
    name: "list",
    summary: "List enabled applications, or everything the catalogue carries.",
    usage: "list [installed|available]",
    group: "store",
    run: (args, ctx) => {
      const what = (args[0] ?? "installed").toLowerCase();
      if (what !== "installed" && what !== "available") {
        ctx.print(line(`list: '${args[0]}' is not a list I have.`, "error"));
        ctx.print(line("  list installed · list available", "muted"));
        return;
      }

      if (what === "available") {
        ctx.print(line(`${appCatalog.length} applications in this build`, "heading"));
        for (const meta of appCatalog) {
          ctx.print(line(`  ${meta.id.padEnd(12)} ${meta.name}  ${meta.version}`, "muted"));
        }
        ctx.print(line("Details and install: install <id>", "muted"));
        return;
      }

      const store = useAppsStore.getState();
      const enabled = enabledAppIds();
      if (enabled.size === 0) {
        ctx.print(line("No applications are enabled yet.", "muted"));
        ctx.print(line("  Enable one in the Store, or with: install <id>", "muted"));
        ctx.print(line("  list available shows everything this build carries", "muted"));
        return;
      }

      ctx.print(line(`${enabled.size} enabled`, "heading"));
      for (const meta of appCatalog) {
        if (!enabled.has(meta.id)) continue;
        const entry = store.installed.find((item) => item.appId === meta.id);
        const drift = entry && entry.version !== meta.version ? `  (recorded ${entry.version})` : "";
        ctx.print(line(`  ${meta.id.padEnd(12)} ${meta.name}  ${meta.version}${drift}`, "muted"));
      }
      ctx.print(
        line(
          "Every bundled application is present in All Apps; this is the set recorded as enabled. remove <id> hides one from All Apps.",
          "muted",
        ),
      );
    },
  },
  {
    name: "update",
    summary: "Re-check enabled applications against the catalogue.",
    usage: "update apps | update <app>",
    group: "store",
    run: (args, ctx) => {
      const store = useAppsStore.getState();
      const target = (args[0] ?? "").toLowerCase();

      if (target && target !== "apps" && target !== "all") {
        const resolution = resolveApp(args.join(" "));
        if (resolution.kind === "unknown") {
          ctx.print(line(`update: no application called '${args.join(" ")}'.`, "error"));
          return;
        }
        if (resolution.kind === "native") {
          refuseNative(ctx, resolution);
          return;
        }
        const meta = resolution.meta;
        const entry = store.installed.find((item) => item.appId === meta.id);
        if (!entry) {
          ctx.print(line(`${meta.name} is not enabled, so there is nothing to update.`, "muted"));
          return;
        }
        if (entry.version === meta.version) {
          ctx.print(line(`${meta.name} is already at ${meta.version}.`, "success"));
          return;
        }
        store.install(meta.id, meta.version);
        ctx.print(line(`${meta.name}  ${entry.version} → ${meta.version}`, "success"));
        return;
      }

      const stale = staleInstalled(store.installed);
      if (stale.length === 0) {
        ctx.print(line("Every enabled application matches the catalogue's version.", "success"));
      } else {
        for (const entry of stale) {
          store.install(entry.appId, entry.to);
          ctx.print(line(`${entry.name}  ${entry.from} → ${entry.to}`, "success"));
        }
      }
      ctx.print(
        line(
          "  Application code ships with the CrystalOS build itself. There is no download here — this only brings the enabled records back in line with this build.",
          "muted",
        ),
      );
    },
  },
];

export const commandNames = commands.map((command) => command.name);

export function findCommand(name: string): CommandDefinition | undefined {
  return commands.find((command) => command.name === name);
}

/** Path completion used by the Tab key. */
export function completePath(cwd: string, fragment: string): string[] {
  const nodes = useFsStore.getState().nodes;
  const slash = fragment.lastIndexOf("/");
  const directoryPart = slash >= 0 ? fragment.slice(0, slash) : "";
  const namePart = slash >= 0 ? fragment.slice(slash + 1) : fragment;

  let baseId = cwd;
  if (slash >= 0) {
    const resolved = directoryPart === ""
      ? ROOT_ID
      : directoryPart.startsWith("/")
        ? resolvePath(nodes, directoryPart)
        : resolvePath(nodes, `${pathString(nodes, cwd)}/${directoryPart}`);
    if (!resolved) return [];
    baseId = resolved;
  }

  return childrenOf(nodes, baseId)
    .filter((child) => child.name.toLowerCase().startsWith(namePart.toLowerCase()))
    .slice(0, 12)
    .map((child) => `${directoryPart}${directoryPart ? "/" : ""}${child.name}${child.kind === "folder" ? "/" : ""}`);
}

export function describeCwd(cwd: string): string {
  return shortPath(cwd);
}
