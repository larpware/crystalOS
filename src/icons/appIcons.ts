/* ==========================================================================
   Bundled application artwork

   The applications below ship a designed 256px PNG tile instead of the drawn
   CrystalOS glyph. The mapping is by catalogue id, so the same artwork is used
   everywhere an application is shown: the taskbar, the launcher, window
   titles, the Store and the icon preview in Settings.

   Applications that are not listed here keep the drawn tile from AppIcon, so
   the shell never shows an empty icon slot.
   ========================================================================== */

/**
 * The artwork lives in `public/icons/apps`, so it is served as-is in both
 * development and production builds. The tile art already carries its own
 * rounded-square plate; AppIcon draws no tint behind it, which keeps the
 * original artwork exactly as designed.
 */
export const appIconArt: Record<string, string> = {
  audiomack: "/icons/apps/audiomack.png",
  browser: "/icons/apps/browser.png",
  calculator: "/icons/apps/calculator.png",
  discord: "/icons/apps/discord.png",
  drive: "/icons/apps/drive.png",
  games: "/icons/apps/games.png",
  // The Game Library is the surviving copy of the games catalogue, under its own
  // id: it keeps the same tile, so the dock row does not change shape.
  library: "/icons/apps/games.png",
  messages: "/icons/apps/messages.png",
  music: "/icons/apps/music.png",
  notes: "/icons/apps/documents.png",
  settings: "/icons/apps/settings.png",
  spotify: "/icons/apps/spotify.png",
  store: "/icons/apps/store.png",
  terminal: "/icons/apps/terminal.png",
};

/** The bundled artwork for an application, or null when it has none. */
export function appArtFor(appId: string): string | null {
  return appIconArt[appId] ?? null;
}
