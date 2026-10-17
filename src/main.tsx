import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initSystemRegistry } from "./shell/systemCommands";

/* Stylesheets are imported in cascade order: tokens first, then base, shared
   primitives, shell chrome, then per-application styles. */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/glass.css";
import "./styles/wallpaper.css";
import "./styles/window.css";
import "./styles/shell.css";
import "./styles/system.css";
import "./styles/widgets.css";
import "./styles/apps/terminal.css";
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
import "./styles/apps/vpn.css";
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* ==========================================================================
   Offline shell

   The service worker keeps the shell loadable offline. It is registered after
   the first paint so it never delays startup, and it is skipped in development
   where Vite serves modules that are not stable between reloads.
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
              worker.postMessage("crescent:skip-waiting");
            }
          });
        });
      })
      .catch(() => {
        // A failed registration must never stop the desktop from running.
      });
  });
}
