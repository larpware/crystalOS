import { useEffect } from "react";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { comboFromEventMatches } from "@/services/keys";
import { dispatchShortcut } from "@/services/shortcuts";

/* ==========================================================================
   Global shortcuts

   This hook is the OS's single keydown listener. It does not decide what a key
   means — the shortcut registry does (`services/shortcuts`), which is why the
   combinations here are the same ones Settings → Keyboard lists and lets the
   user rebind, and why a command in the palette and its shortcut run the same
   code path.

   Two things stay in the hook because they are about the physical keyboard
   rather than a binding:

   - The Super key on its own opens the launcher. The action belongs to the
     key *release*, and a registry binding can only describe a press.
   - Browsers reserve some combinations (Ctrl+W closes the tab, Ctrl+L focuses
     the address bar). Those are still registered; the browser simply wins when
     it claims the key, and Settings marks them so a user is not surprised.
   ========================================================================== */

function platform(): "mac" | "other" {
  if (typeof navigator === "undefined") return "other";
  return /mac|iphone|ipad|ipod/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`)
    ? "mac"
    : "other";
}

export function useGlobalShortcuts(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    let metaDownAlone = false;
    /* Shift + Alt is a chord of two modifiers, so it cannot be a registry
       binding (bindings always need a non-modifier key). It is held in the
       hook instead, like the Super key above: track which modifiers are
       physically down, and when the second of the pair lands with no other
       key in between, the focused window leaves full screen. */
    let downModifiers = new Set<string>();
    let chordUntouched = true;
    const plat = platform();

    const exitFullScreen = () => {
      const window = useWindowStore.getState().windows.find((candidate) => candidate.focused);
      if (window?.full === true) useWindowStore.getState().toggleFullScreen(window.id);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      // Super alone is remembered, so the keyup can toggle the launcher.
      if (event.key === "Meta" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        metaDownAlone = true;
        return;
      }
      if (event.key !== "Meta") metaDownAlone = false;

      if (event.key === "Shift" || event.key === "Alt") {
        const other =
          event.key === "Shift" && (downModifiers.has("Alt") || event.altKey)
            ? "Alt"
            : event.key === "Alt" && (downModifiers.has("Shift") || event.shiftKey)
              ? "Shift"
              : null;
        if (other && chordUntouched && !event.repeat) {
          chordUntouched = false;
          if (!typing) exitFullScreen();
        }
        downModifiers.add(event.key);
        return;
      }
      /* Any ordinary key between the two modifiers means a different
         combination (Alt+Shift is also the browser's layout switch) — the
         chord only counts when its two keys are the only thing pressed. */
      downModifiers.clear();
      chordUntouched = false;

      const id = dispatchShortcut({
        platform: plat,
        typing,
        matches: (binding) => comboFromEventMatches(binding, event, plat),
      });

      // Only claim keys the OS actually used, so a stray Ctrl+K in a text field
      // still reaches the field when no command is bound to it.
      if (id) event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      downModifiers.delete(event.key);
      /* With every modifier released, the keyboard is at rest — the next pair
         of Shift and Alt is a fresh chord attempt, whatever was pressed
         before it. */
      if (downModifiers.size === 0) chordUntouched = true;
      if (event.key !== "Meta" || !metaDownAlone) return;
      metaDownAlone = false;
      const shell = useShellStore.getState();
      // The registry owns "should the launcher be open", so reuse its decision:
      // a Super press toggles whatever is already there.
      shell.setLauncherOpen(!shell.launcherOpen);
    };

    /* Losing the window with modifiers half-held would leave a stale chord. */
    const onBlur = () => {
      downModifiers.clear();
      chordUntouched = true;
      metaDownAlone = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);
}
