import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/ErrorBoundary";
import { initSystemRegistry } from "./shell/systemCommands";
import { startPluginCommands } from "./services/plugins/registry";

/* Stylesheets are imported in cascade order: tokens first, then base, shared
   primitives, shell chrome, then per-application styles. */
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/glass.css";
import "./styles/wallpaper.css";
import "./styles/window.css";
import "./styles/shell.css";
import "./styles/system.css";
import "./styles/widgets.css";
import "./styles/apps/terminal.css";
import "./styles/apps/dev.css";
import "./styles/apps/workshop.css";
import "./styles/apps/calculator.css";
import "./styles/apps/notes.css";
import "./styles/apps/trash.css";
import "./styles/apps/proxy.css";
import "./styles/apps/settings.css";
import "./styles/apps/wallpaper.css";
import "./styles/apps/browser.css";
import "./styles/apps/games.css";
import "./styles/apps/media.css";
import "./styles/apps/store.css";
import "./styles/apps/messages.css";
import "./styles/apps/communities.css";
import "./styles/apps/vpn.css";
import "./styles/apps/ai.css";
import "./styles/apps/social.css";
import "./styles/apps/community.css";
// Last: the small per-application pieces that had markup but no rule. Loaded
// after every app stylesheet so it can complete them without competing.
import "./styles/apps/details.css";

const container = document.getElementById("crystal-root");
if (!container) {
  throw new Error("CrystalOS could not find its mount point (#crystal-root).");
}

/* The command and shortcut registries are populated before React renders, so
   the palette, the Settings → Keyboard list and the keydown dispatcher all see
   the same set from the very first frame. Registration is idempotent. */
initSystemRegistry();

/* Installed plugins add their commands to that same registry, under their own
   owner ids, so removing a plugin takes away exactly its own commands and
   nothing else. Applying them here — after the built-ins and before the first
   render — means the palette never shows a half-populated list. */
startPluginCommands();

/* The desktop is wrapped in the same boundary the window manager puts around
   each application. Without one, a crash anywhere in the root tree — a bad
   persisted value, a theme that will not resolve, an effect that throws —
   unmounts the whole tree and leaves an empty near-black page with nothing to
   read and no way back. With it, the failure names itself and offers a reload,
   and the stored profile is left untouched. */
createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary appName="CrystalOS">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

/* ==========================================================================
   Offline shell

   The service worker keeps the shell loadable offline. It is registered after
   the first paint so it never delays startup, and it is skipped in development
   where Vite serves modules that are not stable between reloads.

   Development is not left without a worker, though: the Scramjet bootstrap
   registers the same script to route proxied requests (see services/scramjet).
   Only the offline-shell half is skipped here, and sw.js refuses to cache a
   development document in either case — see the note on the shell cache there.
   ========================================================================== */

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // A waiting worker means a newer shell is ready; activate it now so the
        // next navigation loads the current build rather than a stale one.
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", (event) => {
            const worker = event.target as ServiceWorker;
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage("crystal:skip-waiting");
            }
          });
        });
      })
      .catch(() => {
        // A failed registration must never stop the desktop from running.
      });
  });
}
