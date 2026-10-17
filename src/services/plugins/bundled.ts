import type { PluginManifest } from "./manifest";

/* ==========================================================================
   Bundled plugins

   These ship with the OS so the feature can be used — and understood — without
   writing JSON first. They are not privileged: they are the same manifests a
   file would carry, they go through the same validation, and they appear in the
   same list with the same permissions, off until the user installs them.

   Each one is a recipe, which is the only shape a plugin can take: a named
   sequence of commands the OS already has. Anything more expressive than that
   would need somewhere to put code.
   ========================================================================== */

const deskTools: PluginManifest = {
  id: "desk-tools",
  name: "Desk tools",
  version: "1.0.0",
  author: "CrystalOS",
  description: "Three one-step ways to clear the desk and get it back.",
  permissions: ["window", "session", "notify"],
  commands: [
    {
      id: "tidy",
      name: "Desk: tidy up",
      description: "Minimise every open window, leaving the desktop clear.",
      keywords: ["clear", "minimise", "desk"],
      steps: [
        { command: "window.minimize-all" },
        { notify: { title: "Desk tidied", body: "Every window is minimised and waiting on the taskbar." } },
      ],
    },
    {
      id: "clear",
      name: "Desk: save and clear",
      description: "Save the current session, then close every window.",
      keywords: ["reset", "close everything", "clear"],
      confirm: "Save the session and close every open window?",
      steps: [
        { command: "session.save" },
        { command: "window.close-all" },
        { notify: { title: "Cleared", body: "The session was saved before the windows closed." } },
      ],
    },
    {
      id: "restore",
      name: "Desk: bring it back",
      description: "Restore every window that was minimised.",
      keywords: ["restore", "reopen", "desk"],
      steps: [
        { command: "window.restore-all" },
        { notify: { title: "Windows restored" } },
      ],
    },
  ],
};

const windDown: PluginManifest = {
  id: "wind-down",
  name: "Wind down",
  version: "1.0.0",
  author: "CrystalOS",
  description: "Save the session and put the machine to sleep in one step.",
  permissions: ["session", "system", "notify"],
  commands: [
    {
      id: "sleep",
      name: "Wind down: save, then sleep",
      description: "Saves the session first, so the desk is still here tomorrow.",
      keywords: ["sleep", "save", "night"],
      steps: [
        { notify: { title: "Saving the session" } },
        { command: "session.save" },
        { command: "system.sleep" },
      ],
    },
    {
      id: "save-lock",
      name: "Wind down: save, then lock",
      description: "Saves the session and locks the screen.",
      keywords: ["lock", "save", "away"],
      steps: [
        { command: "session.save" },
        { command: "system.lock" },
        { notify: { title: "Locked", body: "The session was saved before the screen locked." } },
      ],
    },
  ],
};

/**
 * Raw manifests, deliberately unvalidated here: a bundled manifest that stopped
 * being valid should be a failing test, not a plugin that vanishes quietly from
 * the page.
 */
export const bundledManifests: PluginManifest[] = [deskTools, windDown];
