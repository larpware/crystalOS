import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/icons/Icon";
import { Button, PasswordInput } from "@/components/ui";
import { AccountForm } from "./AccountForm";
import { useClock } from "@/hooks/useClock";
import { useAuthStore } from "@/state/auth";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { WallpaperLayer } from "@/wallpapers/Wallpaper";
import { restartSession, sleepSession, powerOff } from "@/services/os";
import { fontStack } from "@/themes/fonts";
import { formatDateLong, formatTime } from "@/utils/format";

/* ==========================================================================
   Lock screen

   Takes the composition cues people expect from a lock screen — large clock,
   centred avatar, one field — while staying inside the CrystalOS visual
   language. Every part of it is configurable from Settings → Lock Screen.
   ========================================================================== */

export function LockScreen() {
  const config = useShellStore((state) => state.lock);
  const setPowerState = useShellStore((state) => state.setPowerState);

  const account = useAuthStore((state) => state.account);
  const mode = useAuthStore((state) => state.mode);
  const signIn = useAuthStore((state) => state.signIn);
  const startGuestSession = useAuthStore((state) => state.startGuestSession);

  // A password can only unlock a session that already exists. Anything else —
  // signed out, or never signed in — gets the full sign-in form below.
  const canPasswordUnlock = Boolean(account) && !account?.guest && mode === "signed-in";

  const motion = useSystemStore((state) => state.motionOverride);
  const reduceMotion = motion === "reduced";

  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(account?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tick = useClock(config.showSeconds ? 1000 : 15_000);
  const clock12h = useShellStore((state) => state.panel.clock12h);
  const date = new Date(tick);

  /* The clock block is one flex item on a column axis, so the vertical part of
     the position maps to justify-content and the horizontal part to
     align-items. "center" is the single-name shorthand for both. */
  const [vertical, horizontal] =
    config.clockPosition === "center" ? ["center", "center"] : config.clockPosition.split("-");
  const alignItems =
    horizontal === "left" ? "flex-start" : horizontal === "right" ? "flex-end" : "center";
  const justifyContent =
    vertical === "top" ? "flex-start" : vertical === "bottom" ? "flex-end" : "center";
  const textAlign = horizontal === "left" ? "left" : horizontal === "right" ? "right" : "center";
  const backgroundStyle = config.backgroundStyle ?? "wallpaper";
  const blurred =
    (backgroundStyle === "blur" || config.blurWallpaper) &&
    backgroundStyle !== "solid" &&
    !reduceMotion;

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const unlock = useCallback(() => setPowerState("on"), [setPowerState]);

  const submit = useCallback(async () => {
    if (busy) return;

    // Guests have nothing to unlock, and a signed-out desktop has no session
    // to check a password against — the form below handles that case.
    if (!canPasswordUnlock) {
      unlock();
      return;
    }

    if (!password) {
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      setError("Enter your password to unlock.");
      return;
    }

    setBusy(true);
    // The password is checked by the account server, which also refreshes the
    // session cookie instead of trusting one held in this tab.
    const ok = await signIn(username || account?.username || "", password);
    setBusy(false);
    if (ok) {
      unlock();
      return;
    }
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
    setError(useAuthStore.getState().error ?? "That username or password was not accepted.");
    setPassword("");
  }, [account?.username, busy, canPasswordUnlock, password, signIn, unlock, username]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
      if (event.key === "Escape") unlock();
    },
    [submit, unlock],
  );

  return (
    <div
      className="cr-lock"
      data-blur={blurred}
      data-bg={backgroundStyle}
      style={{ "--lock-clock-scale": config.clockScale } as CSSProperties}
    >
      <WallpaperLayer target="lock" dimmed={backgroundStyle !== "solid"} />
      {config.dim > 0 && (
        <div className="cr-lock__dim" style={{ opacity: config.dim }} aria-hidden="true" />
      )}
      <div className="cr-lock__depth" aria-hidden="true" />

      <div
        className="cr-lock__content"
        data-position={config.clockPosition}
        style={{ alignItems, justifyContent }}
        onKeyDown={onKeyDown}
      >
        <div
          className="cr-lock__clock"
          data-style={config.clockStyle}
          data-align={textAlign}
          style={{ fontFamily: fontStack(config.fontId) }}
        >
          {config.showDate && <div className="cr-lock__date">{formatDateLong(date, true)}</div>}
          {config.showTime && (
            <div className="cr-lock__time cr-num">
              {formatTime(date, clock12h, config.showSeconds)}
            </div>
          )}
          {config.message && <div className="cr-lock__message">{config.message}</div>}
        </div>

        <div className="cr-lock__identity" data-shake={shake}>
          {config.showAvatar && (
            <div className="cr-lock__avatar">
              {account?.avatar ? (
                <img src={account.avatar} alt="" />
              ) : (
                <Icon name="user" size={34} strokeWidth={1.4} />
              )}
            </div>
          )}

          {config.showUsername && (
            <div className="cr-lock__name">{account?.displayName ?? "CrystalOS"}</div>
          )}

          {mode === "guest" ? (
            <div className="cr-lock__actions">
              <Button variant="primary" size="lg" icon="check" onClick={unlock}>
                Return to guest session
              </Button>
              <Button
                variant="ghost"
                size="lg"
                icon="log-out"
                onClick={() => void useAuthStore.getState().signOut()}
              >
                Sign in to an account
              </Button>
            </div>
          ) : !canPasswordUnlock ? (
            <div className="cr-lock__account">
              <AccountForm
                initialMode="signin"
                onDone={() => {
                  setUsername(useAuthStore.getState().account?.username ?? "");
                  unlock();
                }}
              />
              <Button variant="ghost" size="lg" icon="user" onClick={unlock}>
                Continue without an account
              </Button>
            </div>
          ) : (
            <form
              className="cr-lock__form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <PasswordInput
                ref={inputRef}
                value={password}
                autoComplete="current-password"
                placeholder="Password"
                aria-label="Password"
                className="cr-lock__field"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
              />
              <Button variant="primary" size="lg" iconRight="arrow-right" type="submit" disabled={busy}>
                {busy ? "Unlocking…" : "Unlock"}
              </Button>
            </form>
          )}

          {error && <div className="cr-lock__error">{error}</div>}
          {!canPasswordUnlock && mode !== "guest" && !error && (
            <div className="cr-lock__hint">
              Sign in with your CrystalOS account, create one, or continue without an account. Guest
              sessions keep everything on this device.
            </div>
          )}
        </div>
      </div>

      {config.showPowerButtons && (
        <div className="cr-lock__power">
          <button type="button" className="cr-lock__power-button" onClick={sleepSession}>
            <Icon name="sleep" size={16} />
            Sleep
          </button>
          <button
            type="button"
            className="cr-lock__power-button"
            onClick={() => {
              setPowerState("on");
              restartSession();
            }}
          >
            <Icon name="restart" size={16} />
            Restart
          </button>
          <button type="button" className="cr-lock__power-button" onClick={powerOff}>
            <Icon name="power" size={16} />
            Shut Down
          </button>
          {mode !== "guest" && (
            <button
              type="button"
              className="cr-lock__power-button"
              onClick={() => {
                startGuestSession();
                unlock();
              }}
            >
              <Icon name="user" size={16} />
              Continue as guest
            </button>
          )}
        </div>
      )}
    </div>
  );
}
