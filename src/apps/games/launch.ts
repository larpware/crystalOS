import { launchUrl } from "@/services/os";
import { useGamesStore } from "@/state/games";
import type { CrystalOSGame } from "./catalogue";

/* ==========================================================================
   Game launch

   One place decides how a game starts, so every Play button in the app agrees:
   the catalogue grid, the featured hero, the library list and the detail panel
   all route through launchGame.
   ========================================================================== */

export type LaunchOutcome = "embedded" | "browser" | "external";

/**
 * Starts a game the way its profile asks, and reports which mode was used.
 *
 * Only `embedded` is left for the caller: it means "put the game in the frame",
 * which is the Games window's own job. The other two are completed here — a
 * Browser tab through the OS's own `launchUrl`, or the host's system browser —
 * so a profile that says "Browser tab" behaves the same wherever it is invoked.
 */
export function launchGame(game: CrystalOSGame): LaunchOutcome {
  const profile = useGamesStore.getState().profileFor(game.id);

  if (profile.launchMode === "browser") {
    launchUrl(game.url);
    return "browser";
  }

  if (profile.launchMode === "external") {
    window.open(game.url, "_blank", "noopener,noreferrer");
    return "external";
  }

  return "embedded";
}

/** The name to show for a game: the profile's override, else the catalogue's. */
export function gameDisplayTitle(game: CrystalOSGame, override: string): string {
  const trimmed = override.trim();
  return trimmed || game.title;
}
