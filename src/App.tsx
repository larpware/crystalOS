import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppearanceStore } from "@/state/appearance";
import { useAuthStore } from "@/state/auth";
import { useChatStore } from "@/state/chat";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useFsStore } from "@/state/fs";
import { useSocialStore } from "@/state/social";
import { applyTabIdentity, useTabIdentityStore } from "@/state/cloak";
import { applyTheme } from "@/themes/apply";
import { accentFromHex, customAccentId, findAccent, findTheme, themePresets } from "@/themes/presets";
import { BootScreen, type BootStep } from "@/shell/BootScreen";
import { Desktop } from "@/shell/Desktop";
import { LockScreen } from "@/shell/LockScreen";
import { SetupWizard } from "@/shell/SetupWizard";
import { useGlobalShortcuts } from "@/shell/useGlobalShortcuts";
import { prefersReducedMotion } from "@/services/system";
import { useVpnSync } from "@/hooks/useVpnSync";
import { syncDeveloperMode } from "@/services/devtools";
import { Icon } from "@/icons/Icon";
import { Button } from "@/components/ui";
import { restartSession } from "@/services/os";

/* ==========================================================================
   CrystalOS root

   Decides between the first-run wizard, the lock screen and the desktop, and
   keeps the theme applied. Everything else hangs off the desktop shell.
   ========================================================================== */

export function App() {
  const setupComplete = useSystemStore((state) => state.setupComplete);
  const deviceType = useSystemStore((state) => state.deviceType);
  const performanceMode = useSystemStore((state) => state.performanceMode);
  const motionOverride = useSystemStore((state) => state.motionOverride);
  const sessionStartedAt = useSystemStore((state) => state.sessionStartedAt);
  const markSessionStart = useSystemStore((state) => state.markSessionStart);

  const themeId = useAppearanceStore((state) => state.themeId);
  const accentId = useAppearanceStore((state) => state.accentId);
  const customAccent = useAppearanceStore((state) => state.customAccent);
  const customThemes = useAppearanceStore((state) => state.customThemes);
  const osScale = useAppearanceStore((state) => state.osScale);
  const wallpaper = useAppearanceStore((state) => state.wallpaper);
  const fonts = useAppearanceStore((state) => state.fonts);

  const panelScale = useShellStore((state) => state.panel.panelScale);
  const panelStyle = useShellStore((state) => state.panel.style);
  const panelRadius = useShellStore((state) => state.panel.radius);
  const dockBorderRadius = useShellStore((state) => state.dock.borderRadius);
  const powerState = useShellStore((state) => state.powerState);
  const developerMode = useSystemStore((state) => state.developerMode);
  const reduceTransparency = useSystemStore((state) => state.reduceTransparency);
  const glassSurfaces = useSystemStore((state) => state.glassSurfaces);

  const account = useAuthStore((state) => state.account);
  const mode = useAuthStore((state) => state.mode);
  const restoreSession = useAuthStore((state) => state.restoreSession);

  const attachChat = useChatStore((state) => state.attach);
  const detachChat = useChatStore((state) => state.detach);

  /* ---- boot ------------------------------------------------------------ *
   * The boot screen reports real startup work and nothing else. Each step is
   * marked as its own await finishes, so a session check that takes three
   * seconds keeps the boot screen up for three seconds instead of inventing a
   * progress animation that finishes first.
   *
   * The one deliberate addition is a minimum display time: on a warm profile
   * the whole sequence can finish in a single frame, and a boot screen that
   * flashes for 20ms reads as a glitch rather than as a start-up. */
  const [bootSteps, setBootSteps] = useState<BootStep[]>([]);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const MIN_VISIBLE_MS = 900;
    /** How long the desktop will wait for the account server before starting. */
    const SESSION_WAIT_MS = 4000;

    const settle = async () => {
      // 1. The theme is already written: applyTheme runs in a layout effect, so
      //    it has finished before this effect body even starts. A macrotask is
      //    used rather than requestAnimationFrame on purpose — a background tab
      //    or a non-composited webview may never deliver a frame, and start-up
      //    must not depend on one arriving.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (cancelled) return;
      setBootSteps(["theme"]);

      // 2. Profile data lives in localStorage and is read synchronously by the
      //    stores as they initialise; this yields once so those reads happen
      //    before the desktop is drawn.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (cancelled) return;
      setBootSteps(["theme", "storage"]);

      // 3. The session is an HttpOnly cookie, so "am I signed in?" is a
      //    question only the account server can answer. A refreshed page keeps
      //    its account; a signed-out one stays signed out.
      //
      //    It is raced against a deadline rather than awaited outright: the
      //    desktop must never wait on the account server. A busy backend (it is
      //    also serving the proxy) or an unreachable one would otherwise leave
      //    the boot screen up forever. Losing the race costs nothing — the
      //    request keeps running and the auth store updates when it lands.
      await Promise.race([
        restoreSession(),
        new Promise<void>((resolve) => window.setTimeout(resolve, SESSION_WAIT_MS)),
      ]);
      if (cancelled) return;
      setBootSteps(["theme", "storage", "session"]);

      const remaining = MIN_VISIBLE_MS - (Date.now() - started);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      if (cancelled) return;
      setBooted(true);
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [restoreSession]);

  // Friends, requests and friend messages are only polled while a registered
  // account is signed in. Guests never touch the account server.
  const registered = mode === "signed-in" && Boolean(account) && !account?.guest;
  useEffect(() => {
    if (!setupComplete || !registered) return undefined;
    useSocialStore.getState().start();
    return () => useSocialStore.getState().stop();
  }, [registered, setupComplete, account?.id]);

  /* ---- OS-level tab identity ------------------------------------------ */
  const identityEnabled = useTabIdentityStore((state) => state.enabled);
  const identityPresetId = useTabIdentityStore((state) => state.presetId);

  useEffect(() => {
    // Applies (or restores) the host tab title and favicon whenever the OS
    // setting changes. Any refusal is recorded in the store by the apply step.
    applyTabIdentity();
  }, [identityEnabled, identityPresetId]);

  const systemMotion = useMemo(() => {
    if (motionOverride === "system") {
      if (performanceMode || prefersReducedMotion()) return "reduced" as const;
      return "full" as const;
    }
    return motionOverride;
  }, [motionOverride, performanceMode]);

  /* ---- theme application ---------------------------------------------- */
  // Laid out before paint: applyTheme rewrites ~50 custom properties and the
  // root zoom, so running it after paint would draw every change twice.
  useLayoutEffect(() => {
    const custom = customThemes.find((theme) => theme.id === themeId);
    const preset = findTheme(themeId) ?? themePresets[0];
    // A custom theme layers on top of a preset, so a theme saved before a
    // token existed still renders with every material defined.
    const active = custom
      ? { ...preset, ...custom, tokens: { ...preset.tokens, ...custom.tokens } }
      : preset;
    applyTheme(active, {
      // `default` keeps the theme's own accent; `custom` derives a full accent
      // set from the picked colour; anything else is a curated preset.
      accent:
        accentId === "default"
          ? null
          : accentId === customAccentId
            ? accentFromHex(customAccent)
            : (findAccent(accentId) ?? null),
      osScale,
      panelScale,
      panelStyle,
      panelRadius,
      dockBorderRadius,
      motion: systemMotion,
      performance: performanceMode,
      contrast: themeId === "contrast",
      reduceTransparency,
      glassSurfaces,
      wallpaperDim: wallpaper.dim,
      wallpaperBlur: wallpaper.blur,
      fonts,
    });
  }, [
    accentId,
    customAccent,
    customThemes,
    dockBorderRadius,
    fonts,
    glassSurfaces,
    osScale,
    panelScale,
    panelRadius,
    panelStyle,
    performanceMode,
    reduceTransparency,
    systemMotion,
    themeId,
    wallpaper.blur,
    wallpaper.dim,
  ]);

  /* ---- UI scale: live-magnify without animating every commit ------------ *
   * Dragging the scale slider rewrites the root zoom, which relayouts the page
   * and re-fits every window on each tick. Window and panel transitions would
   * chase those programmatic moves and the desktop would appear to dance, so a
   * short-lived flag on <html> suspends transitions while the value settles.
   * The first run is skipped: boot should not swallow entrance animations. */
  const scaling = useRef(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!scaling.current) {
      scaling.current = true;
      return;
    }
    root.dataset.scaling = "true";
    const id = window.setTimeout(() => {
      root.dataset.scaling = "false";
    }, 180);
    return () => window.clearTimeout(id);
  }, [osScale]);

  /* A brief hint points at the way back whenever the scale is not 100%, so a
     desktop magnified by accident is never a trap. Whatever the entry point —
     slider, wizard or terminal — the same hint answers it. */
  const firstScale = useRef(true);
  const [scaleHint, setScaleHint] = useState(false);
  useEffect(() => {
    if (firstScale.current) {
      firstScale.current = false;
      return;
    }
    if (osScale === 1) {
      setScaleHint(false);
      return;
    }
    setScaleHint(true);
    const id = window.setTimeout(() => setScaleHint(false), 5000);
    return () => window.clearTimeout(id);
  }, [osScale]);

  // Shift+Z returns the interface to 100% from anywhere. A range slider is not
  // a text field, so the shortcut still reaches the OS while it holds focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "z") return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      useAppearanceStore.getState().setOsScale(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Diagnostics are only reachable while developer mode is on.
  useEffect(() => {
    syncDeveloperMode(developerMode);
  }, [developerMode]);

  /* ---- session bootstrap ---------------------------------------------- */
  useEffect(() => {
    markSessionStart();
    // The virtual filesystem is resolved before anything can reference it.
    void useFsStore.getState().nodes;
  }, [markSessionStart]);

  // Messaging attaches only while a profile exists, and detaches on sign-out.
  useEffect(() => {
    if (!setupComplete) return;
    if (account) {
      attachChat(account);
      return () => detachChat();
    }
    return undefined;
  }, [account, attachChat, detachChat, setupComplete]);

  useGlobalShortcuts(setupComplete && powerState === "on");

  /* ---- VPN ------------------------------------------------------------- *
   * The VPN connection is owned by the backend, not by this tab, so the shell
   * keeps a mirror of it in step rather than holding state of its own. Only
   * polled once the desktop is up: during boot and on the lock screen there is
   * nothing that can act on the answer. */
  useVpnSync(setupComplete && powerState === "on");

  /* ---- sleep overlay resumes on any input ----------------------------- */
  useEffect(() => {
    if (powerState !== "sleep") return;
    const wake = () => useShellStore.getState().setPowerState(mode === "none" ? "locked" : "locked");
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [mode, powerState]);

  const sessionMinutes = Math.round((Date.now() - sessionStartedAt) / 60_000);

  if (!booted) {
    return (
      <div className="cr-root" data-device={deviceType}>
        <BootScreen completed={bootSteps} />
      </div>
    );
  }

  return (
    <div className="cr-root" data-device={deviceType}>
      {!setupComplete && <SetupWizard />}

      {setupComplete && powerState === "locked" && <LockScreen />}

      {setupComplete && powerState === "sleep" && (
        <div className="cr-sleep" role="dialog" aria-label="Sleeping">
          <button type="button" className="cr-sleep__wake" onClick={() => useShellStore.getState().setPowerState("locked")}>
            <Icon name="sleep" size={26} />
            <span>Session sleeping</span>
            <span className="cr-sleep__hint">Click anywhere or press a key to return to the lock screen</span>
          </button>
        </div>
      )}

      {setupComplete && powerState === "off" && (
        <div className="cr-off" role="dialog" aria-label="Powered off">
          <div className="cr-off__panel">
            <Icon name="power" size={28} />
            <h1>CrystalOS has shut down</h1>
            <p>
              The session is over. Everything you changed is still stored in this browser profile, so
              starting again restores your desktop.
            </p>
            {sessionMinutes > 0 && (
              <p className="cr-off__meta">This session ran for about {sessionMinutes} minute{sessionMinutes === 1 ? "" : "s"}.</p>
            )}
            <Button variant="primary" icon="restart" onClick={restartSession}>
              Start again
            </Button>
          </div>
        </div>
      )}

      {setupComplete && powerState === "on" && <Desktop />}

      {scaleHint && osScale !== 1 && (
        <div className="cr-scale-hint" role="status" aria-live="polite">
          <span className="cr-scale-hint__title">UI scale {Math.round(osScale * 100)}%</span>
          <span className="cr-scale-hint__body">
            Press <kbd>Shift</kbd> + <kbd>Z</kbd> to reset to 100%
          </span>
        </div>
      )}
    </div>
  );
}

/** Text-entry surfaces own their keystrokes; every other control does not. */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const type = (element as HTMLInputElement).type;
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color"].includes(type);
}
