import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { Badge, Button, Field, PasswordInput, Switch, TextInput } from "@/components/ui";
import { themePresets, accentOptions } from "@/themes/presets";
import { useAppearanceStore } from "@/state/appearance";
import { useAuthStore } from "@/state/auth";
import { useNotificationStore } from "@/state/notifications";
import { useSystemStore, type MotionOverride } from "@/state/system";
import { validatePassword, validateUsername } from "@/services/auth";
import { CrystalMark } from "./CrystalMark";

/* ==========================================================================
   First-run setup

   An installer, not an onboarding marketing flow. Every choice maps to a real
   setting, and each advanced option states its performance cost up front.
   ========================================================================== */

type Profile = "full" | "performance" | "advanced";

/** Individual costs exposed by the Advanced path. */
interface AdvancedFlags {
  liveWallpapers: boolean;
  windowAnimations: boolean;
  backgroundWidgets: boolean;
  wallpaperBlur: boolean;
  notificationBanners: boolean;
}

const steps = ["Welcome", "Profile", "Details", "Appearance", "Account", "Ready"] as const;

/** What a fresh install already has working, shown on the final step. */
const setupChecklist = [
  "Window manager with snapping and resizing",
  "Wallpaper Library with live scenes",
  "Files, Terminal, Notes and Calculator",
  "Theme engine with custom themes",
  "Measured display refresh readout",
];

export function SetupWizard() {
  const completeSetup = useSystemStore((state) => state.completeSetup);
  const setBackgroundWidgetUpdates = useSystemStore((state) => state.setBackgroundWidgetUpdates);
  const setHzDisplay = useSystemStore((state) => state.setHzDisplay);

  const appearance = useAppearanceStore();
  const setPrefs = useNotificationStore((state) => state.setPrefs);

  const signUp = useAuthStore((state) => state.signUp);
  const startGuestSession = useAuthStore((state) => state.startGuestSession);
  const authError = useAuthStore((state) => state.error);

  const [step, setStep] = useState(0);
  const [deviceType, setDeviceType] = useState<"desktop" | "laptop">("desktop");
  const [profile, setProfile] = useState<Profile>("full");
  const [advanced, setAdvanced] = useState<AdvancedFlags>({
    liveWallpapers: false,
    windowAnimations: true,
    backgroundWidgets: true,
    wallpaperBlur: false,
    notificationBanners: true,
  });

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const serverOnline = useAuthStore((state) => state.serverOnline);

  const performanceMode = profile === "performance";

  const motionOverride: MotionOverride = useMemo(() => {
    if (profile === "performance") return "reduced";
    if (profile === "advanced") return advanced.windowAnimations ? "full" : "subtle";
    return "system";
  }, [advanced.windowAnimations, profile]);

  const applySettings = useCallback(() => {
    if (profile === "advanced") {
      appearance.setLive({ enabled: advanced.liveWallpapers });
      appearance.setWallpaper({ blur: advanced.wallpaperBlur ? 8 : 0 });
      setBackgroundWidgetUpdates(advanced.backgroundWidgets);
      setPrefs({ hidden: !advanced.notificationBanners });
    } else {
      appearance.setLive({ enabled: false });
      appearance.setWallpaper({ blur: 0 });
      setBackgroundWidgetUpdates(profile === "full");
    }
    // Performance mode ships with the measured refresh readout visible, since
    // it is the one cheap number worth watching.
    setHzDisplay(performanceMode ? "panel" : "off");
  }, [advanced, appearance, performanceMode, profile, setBackgroundWidgetUpdates, setHzDisplay, setPrefs]);

  const finishWithAccount = useCallback(async () => {
    if (!username.trim()) {
      startGuestSession();
      return true;
    }
    setCreating(true);
    const ok = await signUp({ username: username.trim(), displayName, password });
    setCreating(false);
    return ok;
  }, [displayName, password, signUp, startGuestSession, username]);

  const onNext = useCallback(async () => {
    setLocalError(null);

    // The Advanced details page only exists when the user picked Advanced.
    if (step === 1) {
      setStep(profile === "advanced" ? 2 : 3);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 4) {
      if (username.trim()) {
        const usernameError = validateUsername(username.trim());
        if (usernameError) {
          setLocalError(usernameError);
          return;
        }
        const passwordError = validatePassword(password);
        if (passwordError) {
          setLocalError(passwordError);
          return;
        }
        if (password !== confirm) {
          setLocalError("The two passwords do not match.");
          return;
        }
      }
      const ok = await finishWithAccount();
      if (!ok) {
        setLocalError(authError ?? "Could not create the account.");
        return;
      }
      setStep(5);
      return;
    }
    if (step === 5) {
      applySettings();
      completeSetup({ deviceType, performanceMode, motionOverride });
      return;
    }
    setStep(step + 1);
  }, [
    applySettings,
    authError,
    completeSetup,
    confirm,
    deviceType,
    finishWithAccount,
    motionOverride,
    password,
    performanceMode,
    profile,
    step,
    username,
  ]);

  const onBack = useCallback(() => {
    setLocalError(null);
    if (step === 3 && profile !== "advanced") setStep(1);
    else setStep(Math.max(0, step - 1));
  }, [profile, step]);

  return (
    <div className="cr-setup">
      <div className="cr-setup__panel">
        <aside className="cr-setup__rail">
          <div className="cr-setup__brand">
            <CrystalMark />
            <div>
              <div className="cr-setup__brand-name">CrystalOS</div>
              <div className="cr-setup__brand-sub">Setup</div>
            </div>
          </div>
          <ol className="cr-setup__steps">
            {steps.map((label, index) => (
              <li key={label} data-active={index === step} data-done={index < step}>
                <span className="cr-setup__step-index cr-num">{index + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <div className="cr-setup__rail-foot">
            Nothing leaves this device. Setup stores these choices in this browser profile.
          </div>
        </aside>

        <main className="cr-setup__body">
          {step === 0 && (
            <StepShell
              title="Welcome to CrystalOS"
              lead="A desktop environment that runs entirely in your browser. Setup takes a minute and can be rerun any time from Settings → System."
            >
              <div className="cr-setup__cards">
                <ChoiceCard
                  icon="monitor"
                  title="Desktop"
                  description="No battery indicator in the panel. Suitable for a fixed display."
                  selected={deviceType === "desktop"}
                  onClick={() => setDeviceType("desktop")}
                />
                <ChoiceCard
                  icon="laptop"
                  title="Laptop"
                  description="Shows a battery indicator when the browser exposes battery status."
                  selected={deviceType === "laptop"}
                  onClick={() => setDeviceType("laptop")}
                />
              </div>
              <p className="cr-setup__note">
                CrystalOS does not invent hardware data. If the browser cannot report battery
                level, the indicator stays hidden.
              </p>
            </StepShell>
          )}

          {step === 1 && (
            <StepShell
              title="Choose a performance profile"
              lead="This sets how much of the OS animates and how much work happens in the background."
            >
              <div className="cr-setup__cards cr-setup__cards--stack">
                <ChoiceCard
                  icon="sparkle"
                  title="Full"
                  description="Live wallpapers available, animations at full speed, widgets update continuously."
                  selected={profile === "full"}
                  onClick={() => setProfile("full")}
                />
                <ChoiceCard
                  icon="gauge"
                  title="Performance"
                  description="Reduced motion, no live wallpapers, slower widget updates. Best on older hardware."
                  selected={profile === "performance"}
                  onClick={() => setProfile("performance")}
                />
                <ChoiceCard
                  icon="sliders"
                  title="Advanced"
                  description="Choose each feature yourself, with the cost of each one stated."
                  selected={profile === "advanced"}
                  onClick={() => setProfile("advanced")}
                />
              </div>
            </StepShell>
          )}

          {step === 2 && (
            <StepShell
              title="Performance details"
              lead="Every option below changes real behaviour. Impact labels describe the cost, not a marketing claim."
            >
              <div className="cr-rows">
                <ImpactRow
                  label="Live wallpapers"
                  impact="big"
                  description="Draws a procedural scene continuously on the GPU."
                  checked={advanced.liveWallpapers}
                  onChange={(value) => setAdvanced((current) => ({ ...current, liveWallpapers: value }))}
                />
                <ImpactRow
                  label="Window animations"
                  impact="small"
                  description="Transition timing on window focus, minimise and maximise."
                  checked={advanced.windowAnimations}
                  onChange={(value) => setAdvanced((current) => ({ ...current, windowAnimations: value }))}
                />
                <ImpactRow
                  label="Background widget updates"
                  impact="big"
                  description="Keeps widgets ticking while the desktop is idle. Off drops them to a slow clock."
                  checked={advanced.backgroundWidgets}
                  onChange={(value) => setAdvanced((current) => ({ ...current, backgroundWidgets: value }))}
                />
                <ImpactRow
                  label="Wallpaper blur"
                  impact="small"
                  description="Blurs the wallpaper behind the desktop surface."
                  checked={advanced.wallpaperBlur}
                  onChange={(value) => setAdvanced((current) => ({ ...current, wallpaperBlur: value }))}
                />
                <ImpactRow
                  label="Notification banners"
                  impact="none"
                  description="Slide-in banners for new notifications. The notification centre still records everything."
                  checked={advanced.notificationBanners}
                  onChange={(value) =>
                    setAdvanced((current) => ({ ...current, notificationBanners: value }))
                  }
                />
              </div>
            </StepShell>
          )}

          {step === 3 && (
            <StepShell
              title="Appearance"
              lead="Pick a starting theme and accent. Both can be changed later, and you can build your own theme from any of these."
            >
              <div className="cr-setup__themes">
                {themePresets.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className="cr-setup__theme"
                    data-active={appearance.themeId === theme.id}
                    onClick={() => appearance.setTheme(theme.id)}
                  >
                    <span
                      className="cr-setup__theme-preview"
                      style={{
                        background: `linear-gradient(150deg, ${theme.tokens.surface2} 0%, ${theme.tokens.bgDesktop} 100%)`,
                        borderColor: theme.tokens.borderStrong,
                      }}
                    >
                      <span style={{ background: theme.tokens.surface0 }} />
                      <span style={{ background: theme.tokens.accent }} />
                    </span>
                    <span className="cr-setup__theme-name">{theme.name}</span>
                    {theme.recommended && <span className="cr-setup__theme-flag">recommended</span>}
                    {theme.deprecated && (
                      <span className="cr-setup__theme-flag cr-setup__theme-flag--deprecated">
                        deprecated
                      </span>
                    )}
                    <span className="cr-setup__theme-desc">{theme.description}</span>
                  </button>
                ))}
              </div>

              <div className="cr-setup__accent-row">
                <span className="cr-field__label">Accent</span>
                <div className="cr-setup__accents">
                  <button
                    type="button"
                    className="cr-setup__accent"
                    data-active={appearance.accentId === "default"}
                    onClick={() => appearance.setAccent("default")}
                    title="Theme default"
                  >
                    <Icon name="refresh" size={13} />
                  </button>
                  {accentOptions.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      className="cr-setup__accent"
                      data-active={appearance.accentId === accent.id}
                      style={{ background: accent.value }}
                      title={accent.name}
                      onClick={() => appearance.setAccent(accent.id)}
                    />
                  ))}
                  {/* Any colour, not just the six curated swatches. */}
                  <input
                    type="color"
                    className="cr-color-input"
                    aria-label="Custom accent colour"
                    title="Custom colour"
                    value={appearance.customAccent}
                    onChange={(event) => appearance.setCustomAccent(event.target.value)}
                  />
                </div>
              </div>

              <p className="cr-setup__note">
                The theme also brings its own wallpaper, so the desktop arrives finished rather than
                half-applied. Both are changeable from Settings → Appearance and the Wallpaper
                Library.
              </p>

              <div className="cr-setup__scale">
                <label className="cr-field__label" htmlFor="setup-scale">
                  UI scale
                </label>
                <input
                  id="setup-scale"
                  type="range"
                  min={75}
                  max={200}
                  value={Math.round(appearance.osScale * 100)}
                  onChange={(event) => appearance.setOsScale(Number(event.target.value) / 100)}
                />
                <span className="cr-num">{Math.round(appearance.osScale * 100)}%</span>
              </div>
            </StepShell>
          )}

          {step === 4 && (
            <StepShell
              title="Account"
              lead="Accounts live on the CrystalOS account server: the password is stored only as a scrypt hash, and a friend code is assigned automatically. Skip this and continue as a guest — everything else still works."
            >
              <div className="cr-setup__form">
                <Field
                  label="Username"
                  hint="How you sign in, and unique across all CrystalOS accounts. Letters, numbers, dot, dash, underscore."
                >
                  <TextInput
                    value={username}
                    placeholder="luna"
                    autoComplete="username"
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>
                <Field label="Display name" hint="Shown on the lock screen and to your friends.">
                  <TextInput
                    value={displayName}
                    placeholder="Luna"
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field label="Password" hint="At least 8 characters. Sent once and stored hashed.">
                  <PasswordInput
                    value={password}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm password">
                  <PasswordInput
                    value={confirm}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>

                <div className="cr-setup__guest">
                  <div>
                    <div className="cr-row__label">Guest mode</div>
                    <div className="cr-row__desc">
                      Skip the account. The desktop works fully, but there is no friend code, no
                      friends list and nothing that syncs.
                    </div>
                  </div>
                  <Button
                    icon="user"
                    onClick={() => {
                      startGuestSession();
                      setUsername("");
                      setDisplayName("");
                      setPassword("");
                      setConfirm("");
                      setStep(5);
                    }}
                  >
                    Continue as guest
                  </Button>
                </div>

                {localError && <div className="cr-field__error">{localError}</div>}
                {!serverOnline && (
                  <p className="cr-setup__note">
                    The account server is not reachable, so creating an account will fail. Guest mode
                    still works, and you can create the account later from Settings → Accounts.
                  </p>
                )}
              </div>
            </StepShell>
          )}

          {step === 5 && (
            <StepShell
              title="Ready"
              lead="CrystalOS will start with a clean desktop. Widgets are opt-in, so nothing is placed for you."
            >
              <ul className="cr-setup__summary">
                <li>
                  <Icon name={deviceType === "desktop" ? "monitor" : "laptop"} size={15} />
                  <span>
                    Device type: <strong>{deviceType}</strong>
                    {deviceType === "laptop" && " · battery shown when available"}
                  </span>
                </li>
                <li>
                  <Icon name="gauge" size={15} />
                  <span>
                    Profile: <strong>{profile}</strong>
                    {performanceMode && " · reduced motion, no live wallpapers"}
                  </span>
                </li>
                <li>
                  <Icon name="palette" size={15} />
                  <span>
                    Theme: <strong>{themeName(appearance.themeId)}</strong> · accent{" "}
                    <strong>{appearance.accentId}</strong>
                  </span>
                </li>
                <li>
                  <Icon name="user" size={15} />
                  <span>
                    {username.trim() ? (
                      <>
                        Account: <strong>{username}</strong> · friend code assigned by the server
                      </>
                    ) : (
                      <>
                        Session: <strong>guest</strong> · local only, no friend code
                      </>
                    )}
                  </span>
                </li>
                <li>
                  <Icon name="grid" size={15} />
                  <span>
                    Widgets: <strong>none added</strong> · add them from Settings → Widgets
                  </span>
                </li>
              </ul>

              <div className="cr-setup__checklist">
                {setupChecklist.map((item) => (
                  <span key={item} className="cr-setup__check">
                    <Icon name="check" size={13} />
                    {item}
                  </span>
                ))}
              </div>
            </StepShell>
          )}

          <footer className="cr-setup__footer">
            <div className="cr-setup__footer-left">
              {step > 0 && step < 5 && (
                <Button variant="ghost" icon="chevron-left" onClick={onBack}>
                  Back
                </Button>
              )}
            </div>
            <div className="cr-setup__footer-right">
              <span className="cr-setup__step-count cr-num">
                Step {Math.min(step + 1, steps.length)} of {steps.length}
              </span>
              <Button
                variant="primary"
                iconRight={step === 5 ? "check" : "arrow-right"}
                disabled={creating}
                onClick={() => void onNext()}
              >
                {step === 5 ? "Start CrystalOS" : creating ? "Creating account…" : "Continue"}
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function StepShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="cr-setup__content">
      <h1 className="cr-setup__title">{title}</h1>
      <p className="cr-setup__lead">{lead}</p>
      <div className="cr-setup__content-body">{children}</div>
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="cr-setup__card" data-active={selected} onClick={onClick}>
      <Icon name={icon} size={20} />
      <span className="cr-setup__card-title">{title}</span>
      <span className="cr-setup__card-desc">{description}</span>
      {selected && (
        <span className="cr-setup__card-check">
          <Icon name="check" size={13} />
        </span>
      )}
    </button>
  );
}

const impactTone = {
  big: { label: "BIG PERFORMANCE IMPACT", tone: "danger" as const },
  small: { label: "SMALL PERFORMANCE IMPACT", tone: "warning" as const },
  none: { label: "NO PERFORMANCE IMPACT", tone: "default" as const },
};

function ImpactRow({
  label,
  impact,
  description,
  checked,
  onChange,
}: {
  label: string;
  impact: keyof typeof impactTone;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const meta = impactTone[impact];
  return (
    <div className="cr-row cr-setup__impact">
      <div className="cr-row__text">
        <div className="cr-row__label">
          {label}
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <div className="cr-row__desc">{description}</div>
      </div>
      <div className="cr-row__control">
        <Switch label={label} checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

function themeName(id: string): string {
  return themePresets.find((theme) => theme.id === id)?.name ?? id;
}


