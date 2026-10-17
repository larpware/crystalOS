import { useState, type FormEvent } from "react";
import { Button, Field, PasswordInput, Segmented, TextInput } from "@/components/ui";
import { validateDisplayName, validatePassword, validateUsername } from "@/services/auth";
import { useAuthStore } from "@/state/auth";

/* ==========================================================================
   Account form

   One component, two homes: the lock screen (so a signed-out desktop can be
   signed into) and Settings → Accounts. It only talks to the auth store, which
   only talks to the account server, so the rules it enforces here are
   conveniences — the server re-validates everything.
   ========================================================================== */

export type AccountFormMode = "signin" | "register";

export function AccountForm({
  initialMode = "signin",
  onDone,
  submitLabel,
  showModeSwitch = true,
}: {
  initialMode?: AccountFormMode;
  onDone?: () => void;
  submitLabel?: string;
  showModeSwitch?: boolean;
}) {
  const signIn = useAuthStore((state) => state.signIn);
  const signUp = useAuthStore((state) => state.signUp);
  const busy = useAuthStore((state) => state.busy);
  const storeError = useAuthStore((state) => state.error);
  const serverOnline = useAuthStore((state) => state.serverOnline);

  const [mode, setMode] = useState<AccountFormMode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setPassword("");
    setConfirm("");
    setLocalError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (mode === "signin") {
      if (!identifier.trim()) {
        setLocalError("Enter your username.");
        return;
      }
      setLocalError(null);
      if (await signIn(identifier, password)) {
        reset();
        onDone?.();
      }
      return;
    }

    const usernameError = validateUsername(identifier.trim());
    if (usernameError) {
      setLocalError(usernameError);
      return;
    }
    const displayNameError = validateDisplayName(displayName.trim());
    if (displayNameError) {
      setLocalError(displayNameError);
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

    setLocalError(null);
    if (await signUp({ username: identifier.trim(), displayName: displayName.trim(), password })) {
      reset();
      onDone?.();
    }
  };

  const error = localError ?? storeError;

  return (
    <form className="cr-account-form" onSubmit={(event) => void submit(event)}>
      {showModeSwitch && (
        <Segmented
          label="Account action"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setLocalError(null);
            useAuthStore.getState().clearError();
          }}
          options={[
            { value: "signin", label: "Sign in" },
            { value: "register", label: "Create account" },
          ]}
        />
      )}

      <Field
        label="Username"
        hint={mode === "register" ? "Letters, numbers, dot, dash or underscore. Must be unique." : undefined}
        htmlFor="account-identifier"
      >
        <TextInput
          id="account-identifier"
          value={identifier}
          autoComplete="username"
          placeholder="luna"
          spellCheck={false}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </Field>

      {mode === "register" && (
        <Field label="Display name" hint="Shown on the lock screen and to friends." htmlFor="account-display-name">
          <TextInput
            id="account-display-name"
            value={displayName}
            placeholder="Luna"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      )}

      <Field
        label="Password"
        hint={mode === "register" ? "At least 8 characters. Stored only as a scrypt hash on the server." : undefined}
        htmlFor="account-password"
      >
        <PasswordInput
          id="account-password"
          value={password}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          placeholder="••••••••"
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      {mode === "register" && (
        <Field label="Confirm password" htmlFor="account-confirm">
          <PasswordInput
            id="account-confirm"
            value={confirm}
            autoComplete="new-password"
            placeholder="••••••••"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
      )}

      {error && <div className="cr-field__error">{error}</div>}
      {!serverOnline && mode === "signin" && !error && (
        <p className="cr-row__desc">
          The account server is not reachable, so signing in is not possible right now. Guest mode
          still works.
        </p>
      )}

      <Button variant="primary" type="submit" icon="arrow-right" disabled={busy}>
        {busy
          ? mode === "register"
            ? "Creating account…"
            : "Signing in…"
          : (submitLabel ?? (mode === "register" ? "Create account" : "Sign in"))}
      </Button>

      {mode === "register" && (
        <p className="cr-row__desc">
          Creating an account assigns a friend code automatically. It is permanent — CrystalOS never
          lets anyone choose or change their own code.
        </p>
      )}
    </form>
  );
}
