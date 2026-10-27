/* ==========================================================================
   Boot tips

   One line is shown at the foot of the boot screen while the shell starts, in
   the spirit of a game's loading screen — except the subject is the operating
   system that is starting.

   House rule: every tip names something this build actually does. A tip that
   quotes a shortcut quotes one that is really bound (see shortcutDefaults in
   shell/systemCommands.ts), and a tip that quotes a setting names one that
   really exists in the Settings app. A boot screen is a bad place to promise
   something the desktop cannot deliver, so if a feature moves, move its tip
   with it — or delete it.
   ========================================================================== */

export const BOOT_TIPS: readonly string[] = [
  "Press Ctrl + K to open CrystalOS Quick Search and run any command by name.",
  "Ctrl + Alt + T opens a new Terminal without touching the taskbar.",
  "Alt + W shows every workspace and the windows on it at once.",
  "Ctrl + Alt + ← and → step between workspaces.",
  "Ctrl + Alt + 1 through 6 jump straight to a numbered workspace.",
  "Alt + Shift + L cycles the snap layouts for this workspace.",
  "Alt + Shift + U returns a snapped window to its own size.",
  "Alt + Tab cycles between open windows.",
  "Shift + Z toggles full screen for the focused window; right-click it for close and minimize.",
  "Ctrl + Space toggles the application launcher.",
  "Ctrl + Alt + S saves the desktop by hand, before you try something risky.",
  "The whole interface scale is adjustable under Settings → Appearance.",
  "All Apps has its own icon size and tile size sliders under Settings → All Apps.",
  "Every theme takes a different accent colour; Settings → Appearance lists them all.",
  "A wallpaper can be zoomed, panned and cropped under Settings → Wallpaper.",
  "The taskbar can be moved, hidden or made to show app labels — Settings → Taskbar.",
  "The wallpaper can be dimmed and blurred without changing the picture itself.",
  "Widgets sit on the desktop and can be dragged into place — Settings → Widgets.",
  "Settings has a search box: type \"dock\", \"wallpaper\" or \"boot\" to jump straight there.",
  "Quick Search can save, restore or forget the whole desktop — search for \"session\".",
  "CrystalVPN needs no account: name an endpoint yourself, or let it find a public one.",
  "The Browser carries its own per-tab proxy switch, separate from the OS-wide one.",
  "Tab identity can dress the browser tab as another site — Settings → Tab identity.",
  "Performance mode turns off live wallpapers and heavy animation — Settings → Performance.",
  "The Trash holds deleted files until you empty it.",
  "Notes, Calculator and the Terminal all keep working with no network connection.",
  "The Store lists optional applications that are not bundled with the OS.",
  "Games has an Editor's Choice shelf alongside the full catalogue.",
  "The Update Log lists what changed in every release.",
  "Every setting you change is stored in this browser profile, not on a server.",
];
