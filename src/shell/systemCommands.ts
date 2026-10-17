import { games } from "@/apps/games/catalogue";
import { appRegistry } from "@/apps/registry";
import { combo } from "@/services/keys";
import { registerCommands, type Command } from "@/services/commands";
import { applyLayout, layoutChoices } from "@/services/layouts";
import { lockSession, notify, openApp, sleepSession } from "@/services/os";
import {
  clearSession,
  flushSessionSave,
  useSessionStore,
} from "@/services/session";
import { registerShortcuts, type ShortcutDefinition } from "@/services/shortcuts";
import { useNotificationStore } from "@/state/notifications";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { useWorkspaceStore } from "@/state/workspaces";

/* ==========================================================================
   System commands and shortcuts

   Everything CrystalOS can be asked to do, declared once. The command palette
   lists these, the shortcut registry binds some of them to keys, and the
   automation engine runs them by id — no feature ever grows its own private
   copy of "open Settings" or "switch workspace".
   ========================================================================== */

const SETTINGS_SECTIONS: { id: string; label: string; keywords: string[] }[] = [
  { id: "appearance", label: "Appearance", keywords: ["theme", "accent", "colour", "motion", "scale"] },
  { id: "wallpaper", label: "Wallpaper", keywords: ["background", "live", "dim", "blur"] },
  { id: "dock", label: "Taskbar", keywords: ["dock", "panel", "autohide"] },
  { id: "widgets", label: "Widgets", keywords: ["desktop", "clock", "weather"] },
  { id: "notifications", label: "Notifications", keywords: ["toast", "do not disturb", "dnd"] },
  { id: "keyboard", label: "Keyboard", keywords: ["shortcut", "hotkey", "keys"] },
  { id: "workspaces", label: "Workspaces", keywords: ["virtual desktop", "spaces"] },
  { id: "session", label: "Session", keywords: ["restore", "reopen", "autosave"] },
  { id: "applications", label: "Applications", keywords: ["install", "remove", "recent"] },
  { id: "browser", label: "Browser", keywords: ["proxy", "scramjet", "search engine"] },
  { id: "network", label: "Network", keywords: ["offline", "connectivity"] },
  { id: "power", label: "Power", keywords: ["battery", "sleep", "lock"] },
  { id: "performance", label: "Performance", keywords: ["motion", "animation", "speed"] },
  { id: "privacy", label: "Privacy", keywords: ["telemetry", "data"] },
  { id: "accounts", label: "Accounts", keywords: ["profile", "sign in"] },
  { id: "advanced", label: "Advanced", keywords: ["storage", "reset", "diagnostics"] },
  { id: "about", label: "About", keywords: ["version", "build"] },
];

function openSettingsSection(section: string): void {
  openApp("settings", { args: { section } });
}

function focusedWindow() {
  return useWindowStore.getState().windows.find((window) => window.focused) ?? null;
}

/** Applies a layout and remembers it as the workspace's arrangement. */
export function applyLayoutAndRemember(layoutId: string, source = "the palette"): boolean {
  const result = applyLayout(layoutId);
  if (!result.ok) {
    notify({ title: "Layout not applied", body: result.reason, icon: "warning" });
    return false;
  }
  const spaces = useWorkspaceStore.getState();
  spaces.setLayout(spaces.activeId, layoutId);
  if (result.extra > 0) {
    notify({
      title: "Layout applied",
      body: `${result.applied} windows placed, ${result.extra} left as they were — this layout has ${result.applied} regions.`,
      icon: "layout",
    });
  } else if (source !== "the palette") {
    notify({ title: "Layout applied", body: `${result.applied} window(s) placed.`, icon: "layout" });
  }
  return true;
}

export function cycleWorkspaceLayout(direction: 1 | -1 = 1): boolean {
  const choices = layoutChoices()
    .filter((entry) => entry.usable)
    .map((entry) => entry.layout);
  if (choices.length === 0) return false;
  const spaces = useWorkspaceStore.getState();
  const current = spaces.workspaces.find((workspace) => workspace.id === spaces.activeId)?.layoutId;
  const index = choices.findIndex((layout) => layout.id === current);
  const next = choices[((index < 0 ? -direction : index) + direction + choices.length) % choices.length];
  return applyLayoutAndRemember(next.id, "shortcut");
}

export function renameActiveWorkspace(name: string): void {
  const spaces = useWorkspaceStore.getState();
  spaces.rename(spaces.activeId, name);
}

export function registerSystemCommands(): void {
  const commands: Command[] = [];

  /* ---- applications ------------------------------------------------------ */
  for (const app of appRegistry) {
    commands.push({
      id: `app.open.${app.id}`,
      name: `Open ${app.name}`,
      description: app.summary,
      category: "Applications" as const,
      keywords: ["launch", "start", app.category, app.id],
      icon: app.icon,
      run: () => {
        openApp(app.id);
      },
    });
  }
  commands.push({
    id: "app.all",
    name: "Show all applications",
    description: "Open the launcher.",
    category: "Applications" as const,
    keywords: ["launcher", "start menu", "apps"],
    icon: "grid",
    run: () => useShellStore.getState().setLauncherOpen(true),
  });

  /* ---- games ------------------------------------------------------------- */
  for (const game of games) {
    commands.push({
      id: `game.launch.${game.id}`,
      name: `Play ${game.title}`,
      description: game.url,
      category: "Games" as const,
      keywords: ["game", "play", game.category, game.collection, game.host],
      icon: "games",
      run: () => {
        openApp("games", { args: { gameId: game.id } });
      },
    });
  }

  /* ---- workspaces -------------------------------------------------------- */
  commands.push(
    {
      id: "workspace.overview",
      name: "Workspace overview",
      description: "See every workspace and the windows on it.",
      category: "Workspaces" as const,
      keywords: ["spaces", "virtual desktop", "overview", "expose"],
      icon: "layout",
      run: () => useShellStore.getState().setWorkspaceOverviewOpen(true),
    },
    {
      id: "workspace.new",
      name: "New workspace",
      description: "Add an empty workspace after the current ones.",
      category: "Workspaces" as const,
      keywords: ["create", "add", "space"],
      icon: "plus",
      run: () => {
        const id = useWorkspaceStore.getState().create();
        useWorkspaceStore.getState().activate(id);
        notify({ title: "Workspace created", icon: "layout" });
      },
    },
    {
      id: "workspace.next",
      name: "Next workspace",
      category: "Workspaces" as const,
      keywords: ["switch", "right"],
      icon: "arrow-right",
      run: () => useWorkspaceStore.getState().step(1),
    },
    {
      id: "workspace.prev",
      name: "Previous workspace",
      category: "Workspaces" as const,
      keywords: ["switch", "left"],
      icon: "arrow-left",
      run: () => useWorkspaceStore.getState().step(-1),
    },
    {
      id: "workspace.rename",
      name: "Rename the current workspace…",
      description: "Opens Settings → Workspaces.",
      category: "Workspaces" as const,
      keywords: ["rename", "name", "label"],
      icon: "pencil",
      run: () => openSettingsSection("workspaces"),
    },
  );

  const spaces = useWorkspaceStore.getState().workspaces;
  for (const workspace of spaces) {
    commands.push({
      id: `workspace.go.${workspace.id}`,
      name: `Switch to ${workspace.name}`,
      category: "Workspaces" as const,
      keywords: ["workspace", "space", workspace.name],
      hint: workspace.name,
      icon: workspace.icon,
      when: () => useWorkspaceStore.getState().activeId !== workspace.id,
      run: () => useWorkspaceStore.getState().activate(workspace.id),
    });
    commands.push({
      id: `workspace.move.${workspace.id}`,
      name: `Move the focused window to ${workspace.name}`,
      category: "Workspaces" as const,
      keywords: ["send", "move", "window", workspace.name],
      icon: "drag",
      when: () => Boolean(focusedWindow()),
      run: () => {
        const window = focusedWindow();
        if (!window) return;
        useWindowStore.getState().moveToWorkspace(window.id, workspace.id, { follow: true });
      },
    });
  }

  /* ---- windows ----------------------------------------------------------- */
  commands.push(
    {
      id: "window.minimize",
      name: "Minimize the focused window",
      category: "Windows" as const,
      keywords: ["hide", "min"],
      icon: "minimize",
      when: () => Boolean(focusedWindow()),
      run: () => {
        const window = focusedWindow();
        if (window) useWindowStore.getState().minimize(window.id);
      },
    },
    {
      id: "window.maximize",
      name: "Maximize the focused window",
      category: "Windows" as const,
      keywords: ["full", "expand"],
      icon: "maximize",
      when: () => Boolean(focusedWindow()),
      run: () => {
        const window = focusedWindow();
        if (window) useWindowStore.getState().toggleMaximize(window.id);
      },
    },
    {
      id: "window.restore-geometry",
      name: "Return the focused window to its own size",
      description: "Undoes a snap, leaving the window where it was before the layout.",
      category: "Windows" as const,
      keywords: ["unsnap", "float", "restore"],
      icon: "restore",
      when: () => focusedWindow()?.state === "snapped",
      run: () => {
        const window = focusedWindow();
        if (window) useWindowStore.getState().unmaximize(window.id);
      },
    },
    {
      id: "window.close",
      name: "Close the focused window",
      category: "Windows" as const,
      keywords: ["quit", "dismiss"],
      icon: "close",
      when: () => Boolean(focusedWindow()),
      run: () => {
        const window = focusedWindow();
        if (window) useWindowStore.getState().close(window.id);
      },
    },
    {
      id: "window.next",
      name: "Focus the next window",
      category: "Windows" as const,
      keywords: ["cycle", "switch", "alt tab"],
      icon: "columns",
      run: () => useWindowStore.getState().cycleFocus(1),
    },
    {
      id: "window.sticky",
      name: "Show the focused window on every workspace",
      category: "Windows" as const,
      keywords: ["pin", "sticky", "always"],
      icon: "pin",
      when: () => Boolean(focusedWindow()) && !focusedWindow()?.sticky,
      run: () => {
        const window = focusedWindow();
        if (window) {
          useWindowStore.getState().setSticky(window.id, true);
          notify({ title: "Window pinned", body: "It now appears on every workspace.", icon: "pin" });
        }
      },
    },
    {
      id: "window.unsticky",
      name: "Stop showing the focused window everywhere",
      category: "Windows" as const,
      keywords: ["unpin", "sticky"],
      icon: "pin",
      when: () => Boolean(focusedWindow()?.sticky),
      run: () => {
        const window = focusedWindow();
        if (window) useWindowStore.getState().setSticky(window.id, false);
      },
    },
    {
      id: "window.minimize-all",
      name: "Minimize every window on this workspace",
      category: "Windows" as const,
      keywords: ["show desktop"],
      icon: "minimize",
      run: () => useWindowStore.getState().minimizeAll(),
    },
    {
      id: "window.restore-all",
      name: "Restore the minimized windows",
      category: "Windows" as const,
      keywords: ["unminimize", "show"],
      icon: "restore",
      run: () => useWindowStore.getState().restoreAll(),
    },
    {
      id: "window.close-all",
      name: "Close every window",
      category: "Windows" as const,
      keywords: ["quit all", "destructive"],
      icon: "trash",
      confirm: "Close every open window? Applications that are running will stop.",
      run: () => useWindowStore.getState().closeAll(),
    },
  );

  /* ---- layouts ----------------------------------------------------------- */
  for (const choice of layoutChoices()) {
    commands.push({
      id: `layout.apply.${choice.layout.id}`,
      name: `Arrange windows: ${choice.layout.name}`,
      description: choice.usable
        ? choice.layout.description
        : `${choice.layout.description} — ${choice.reason}`,
      category: "Layouts" as const,
      keywords: ["layout", "snap", "tile", "arrange", choice.layout.name],
      icon: "grid",
      // A layout that cannot fit is reported by its description rather than
      // pretending it is available.
      when: () => choice.usable || useWindowStore.getState().windows.some((window) => !window.minimized),
      run: () => {
        applyLayoutAndRemember(choice.layout.id, "the palette");
      },
    });
  }
  commands.push({
    id: "layout.cycle",
    name: "Cycle snap layouts",
    description: "Step to the next arrangement that fits this window.",
    category: "Layouts" as const,
    keywords: ["next layout", "rotate", "tile"],
    icon: "refresh",
    run: () => cycleWorkspaceLayout(1),
  });

  /* ---- settings ---------------------------------------------------------- */
  for (const section of SETTINGS_SECTIONS) {
    commands.push({
      id: `settings.${section.id}`,
      name: `Settings: ${section.label}`,
      category: "Settings" as const,
      keywords: ["preferences", "options", ...section.keywords],
      icon: "settings",
      run: () => openSettingsSection(section.id),
    });
  }

  /* ---- session ----------------------------------------------------------- */
  commands.push(
    {
      id: "session.save",
      name: "Save this session now",
      category: "Session" as const,
      keywords: ["snapshot", "remember"],
      icon: "download",
      run: () => {
        flushSessionSave();
        notify({ title: "Session saved", icon: "check" });
      },
    },
    {
      id: "session.restore",
      name: "Restore the saved session",
      description: "Closes the desktop and reopens the saved windows.",
      category: "Session" as const,
      keywords: ["reopen", "resume"],
      icon: "refresh",
      confirm: "Restore the saved session? Windows open right now will be closed.",
      run: () => {
        useWindowStore.getState().closeAll();
        void import("@/services/session").then((module) => module.restoreSession());
      },
    },
    {
      id: "session.toggle",
      name: useSessionStore.getState().restoreOnStart
        ? "Stop restoring the session at startup"
        : "Restore the session at startup",
      category: "Session" as const,
      keywords: ["autosave", "startup"],
      icon: "power",
      run: () => {
        const store = useSessionStore.getState();
        store.setRestoreOnStart(!store.restoreOnStart);
      },
    },
    {
      id: "session.clear",
      name: "Forget the saved session",
      category: "Session" as const,
      keywords: ["delete", "reset", "forget"],
      icon: "trash",
      confirm: "Forget the saved session? The desktop will start empty next time.",
      run: () => {
        clearSession();
        notify({ title: "Saved session cleared", icon: "trash" });
      },
    },
  );

  /* ---- system ------------------------------------------------------------ */
  commands.push(
    {
      id: "system.lock",
      name: "Lock the screen",
      category: "System" as const,
      keywords: ["lock", "secure"],
      icon: "lock",
      run: () => lockSession(),
    },
    {
      id: "system.sleep",
      name: "Sleep",
      category: "System" as const,
      keywords: ["suspend", "sleep"],
      icon: "sleep",
      run: () => sleepSession(),
    },
    {
      id: "system.dnd",
      name: useNotificationStore.getState().prefs.doNotDisturb
        ? "Turn off Do Not Disturb"
        : "Turn on Do Not Disturb",
      category: "System" as const,
      keywords: ["silence", "notifications", "dnd"],
      icon: "bell-off",
      run: () => {
        const store = useNotificationStore.getState();
        store.setPrefs({ doNotDisturb: !store.prefs.doNotDisturb });
      },
    },
    {
      id: "system.quick-settings",
      name: "Open quick settings",
      category: "System" as const,
      keywords: ["tray", "volume", "brightness"],
      icon: "sliders",
      run: () => useShellStore.getState().setQuickSettingsOpen(true),
    },
  );

  registerCommands(commands);
}

/** Default keys. Users can rebind any of them in Settings → Keyboard. */
export function shortcutDefaults(): ShortcutDefinition[] {
  const shell = useShellStore.getState;
  const spaces = useWorkspaceStore.getState;
  const windows = useWindowStore.getState;
  const withWindow = () => Boolean(focusedWindow());

  return [
    {
      id: "palette",
      label: "CrystalOS Quick Search",
      category: "Search",
      description: "Run any command: applications, games, workspaces, layouts, settings.",
      defaultKeys: combo("k", { ctrl: true }),
      icon: "search",
      // The palette must open even from inside a search field.
      whileTyping: true,
      run: () => {
        const state = shell();
        state.setCommandPaletteOpen(!state.commandPaletteOpen);
      },
    },
    {
      id: "overview",
      label: "Workspace overview",
      category: "Workspaces",
      description: "See all workspaces and the windows on them.",
      defaultKeys: combo("w", { alt: true }),
      icon: "layout",
      run: () => {
        const state = shell();
        state.setWorkspaceOverviewOpen(!state.workspaceOverviewOpen);
      },
    },
    {
      id: "workspace-prev",
      label: "Previous workspace",
      category: "Workspaces",
      defaultKeys: combo("arrowleft", { ctrl: true, alt: true }),
      icon: "arrow-left",
      run: () => spaces().step(-1),
    },
    {
      id: "workspace-next",
      label: "Next workspace",
      category: "Workspaces",
      defaultKeys: combo("arrowright", { ctrl: true, alt: true }),
      icon: "arrow-right",
      run: () => spaces().step(1),
    },
    ...([1, 2, 3, 4, 5, 6] as const).map((index) => ({
      id: `workspace-${index}`,
      label: `Switch to workspace ${index}`,
      category: "Workspaces" as const,
      defaultKeys: combo(String(index), { ctrl: true, alt: true }),
      icon: "layout" as const,
      when: () => spaces().workspaces.length >= index,
      run: () => spaces().activateIndex(index - 1),
    })),
    {
      id: "layout-cycle",
      label: "Cycle snap layouts",
      category: "Layouts",
      defaultKeys: combo("l", { alt: true, shift: true }),
      icon: "grid",
      run: () => cycleWorkspaceLayout(1),
    },
    {
      id: "layout-unsnap",
      label: "Return the focused window to its own size",
      category: "Layouts",
      defaultKeys: combo("u", { alt: true, shift: true }),
      icon: "restore",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().unmaximize(window.id);
      },
    },
    {
      id: "launcher",
      label: "Application launcher",
      category: "Shell",
      defaultKeys: combo("space", { ctrl: true }),
      aliases: [combo("space", { meta: true })],
      icon: "grid",
      run: () => {
        const state = shell();
        state.setLauncherOpen(!state.launcherOpen);
      },
    },
    {
      id: "terminal",
      label: "New terminal",
      category: "Applications",
      defaultKeys: combo("t", { ctrl: true, alt: true }),
      icon: "terminal",
      run: () => openApp("terminal", { newInstance: true }),
    },
    {
      id: "minimise",
      label: "Minimize the focused window",
      category: "Windows",
      defaultKeys: combo("h", { meta: true }),
      icon: "minimize",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().minimize(window.id);
      },
    },
    {
      id: "maximise",
      label: "Maximize the focused window",
      category: "Windows",
      defaultKeys: combo("arrowup", { meta: true }),
      icon: "maximize",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().toggleMaximize(window.id);
      },
    },
    {
      id: "snap-left",
      label: "Snap the focused window left",
      category: "Layouts",
      defaultKeys: combo("arrowleft", { meta: true }),
      icon: "layout",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().snap(window.id, "left");
      },
    },
    {
      id: "snap-right",
      label: "Snap the focused window right",
      category: "Layouts",
      defaultKeys: combo("arrowright", { meta: true }),
      icon: "layout",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().snap(window.id, "right");
      },
    },
    {
      id: "cycle",
      label: "Cycle between windows",
      category: "Windows",
      defaultKeys: combo("tab", { alt: true }),
      icon: "columns",
      run: () => windows().cycleFocus(1),
    },
    {
      id: "lock",
      label: "Lock the screen",
      category: "System",
      defaultKeys: combo("l", { meta: true }),
      icon: "lock",
      run: () => lockSession(),
    },
    {
      id: "dnd",
      label: "Toggle Do Not Disturb",
      category: "System",
      defaultKeys: combo("d", { meta: true }),
      icon: "bell-off",
      run: () => {
        const store = useNotificationStore.getState();
        store.setPrefs({ doNotDisturb: !store.prefs.doNotDisturb });
      },
    },
    {
      id: "settings",
      label: "Open Settings",
      category: "Settings",
      defaultKeys: combo("i", { meta: true }),
      icon: "settings",
      run: () => openApp("settings"),
    },
    {
      id: "close-window",
      label: "Close the focused window",
      category: "Windows",
      defaultKeys: combo("w", { ctrl: true }),
      icon: "close",
      when: withWindow,
      run: () => {
        const window = focusedWindow();
        if (window) windows().close(window.id);
      },
    },
    {
      id: "close-all",
      label: "Close every window",
      category: "Windows",
      defaultKeys: combo("w", { ctrl: true, shift: true }),
      icon: "trash",
      run: () => windows().closeAll(),
    },
    {
      id: "dismiss",
      label: "Dismiss the open overlay",
      category: "Shell",
      description: "Escape closes the palette, the overview, menus and the launcher.",
      defaultKeys: combo("escape"),
      icon: "close",
      whileTyping: true,
      run: () => dismissOverlays(),
    },
    {
      id: "save-session",
      label: "Save the session now",
      category: "Session",
      defaultKeys: combo("s", { ctrl: true, alt: true }),
      icon: "download",
      run: () => {
        flushSessionSave();
        notify({ title: "Session saved", icon: "check" });
      },
    },
  ];
}

/** Closes whatever is in front of the desktop. Returns true when something closed. */
export function dismissOverlays(): boolean {
  const shell = useShellStore.getState();
  if (shell.commandPaletteOpen) {
    shell.setCommandPaletteOpen(false);
    return true;
  }
  if (shell.workspaceOverviewOpen) {
    shell.setWorkspaceOverviewOpen(false);
    return true;
  }
  if (shell.contextMenu) {
    shell.closeContextMenu();
    return true;
  }
  if (shell.launcherOpen) {
    shell.setLauncherOpen(false);
    return true;
  }
  if (shell.quickSettingsOpen) {
    shell.setQuickSettingsOpen(false);
    return true;
  }
  if (shell.notificationCenterOpen) {
    shell.setNotificationCenterOpen(false);
    return true;
  }
  return false;
}

export function registerSystemShortcuts(): void {
  registerShortcuts(shortcutDefaults());
}

export function initSystemRegistry(): void {
  registerSystemCommands();
  registerSystemShortcuts();
}
