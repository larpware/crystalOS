import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import {
  authenticate,
  deleteAccount,
  endSession,
  fetchSession,
  registerAccount,
  updateAccount,
} from "@/services/auth";
import type { AccountProfile } from "@/types";
import { createId } from "@/utils/format";

/* ==========================================================================
   Session state

   `account` is a cached view of whoever the account server says is signed in.
   The cookie on the server is the real session; this store exists so the shell
   can render immediately and so guest sessions (which have no server identity
   at all) work identically.

   Guest sessions are deliberately poor in features and honest about it: no
   friend code, no friends, no cross-device anything.
   ========================================================================== */

export type SessionMode = "signed-in" | "guest" | "none";

interface AuthState {
  account: AccountProfile | null;
  mode: SessionMode;
  /** Password gate state for the lock screen; never persisted. */
  lockArmed: boolean;
  busy: boolean;
  error: string | null;
  /**
   * Supabase sign-up created the account, but the project requires the
   * email to be confirmed first — there is no session to show yet. The
   * form turns this into a "check your inbox" panel and resets it.
   */
  confirmationPending: boolean;
  /** True once the boot-time session check has completed. */
  restored: boolean;
  /** Whether the account server answered the last request. */
  serverOnline: boolean;

  /** Reads the session cookie and refreshes the cached account. */
  restoreSession: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<boolean>;
  signUp: (input: {
    username: string;
    displayName: string;
    password: string;
    /** When present, the credentials live with Supabase Auth. */
    email?: string;
  }) => Promise<boolean>;
  signOut: () => Promise<void>;
  startGuestSession: () => void;
  /** Creates the guest profile the first time guest mode is used. */
  ensureGuestProfile: () => AccountProfile;
  updateProfile: (patch: Partial<AccountProfile>) => Promise<boolean>;
  removeAccount: (password: string) => Promise<boolean>;
  setAvatar: (dataUrl: string | undefined) => void;
  clearError: () => void;
}

const guestProfileTemplate = (): AccountProfile => ({
  id: createId("gst"),
  username: "guest",
  displayName: "Guest",
  createdAt: Date.now(),
  guest: true,
  bio: "Guest session — no account, no friend code, and nothing here syncs.",
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      account: null,
      mode: "none",
      lockArmed: false,
      busy: false,
      error: null,
      confirmationPending: false,
      restored: false,
      serverOnline: true,

      restoreSession: async () => {
        const { account, online } = await fetchSession();
        const current = get().account;
        if (!online) {
          // The server is unreachable: keep whatever we had (so the desktop is
          // still usable) but say so instead of pretending to be signed in.
          set({ restored: true, serverOnline: false });
          return;
        }
        if (account) {
          set({ account: { ...account, guest: false }, mode: "signed-in", restored: true, serverOnline: true, error: null });
          return;
        }
        // No server session. A cached non-guest account is now stale.
        if (current && !current.guest) {
          set({ account: null, mode: "none", restored: true, serverOnline: true });
          return;
        }
        set({ restored: true, serverOnline: true });
      },

      signIn: async (identifier, password) => {
        set({ busy: true, error: null });
        const result = await authenticate(identifier, password);
        if (!result.ok || !result.account) {
          set({
            busy: false,
            error: result.error ?? "Could not sign in.",
            serverOnline: result.code !== "SERVER_UNREACHABLE",
          });
          return false;
        }
        set({
          account: { ...result.account, guest: false },
          mode: "signed-in",
          busy: false,
          error: null,
          serverOnline: true,
          lockArmed: false,
          restored: true,
        });
        return true;
      },

      signUp: async (input) => {
        set({ busy: true, error: null, confirmationPending: false });
        const result = await registerAccount(input);
        if (!result.ok || !result.account) {
          // Email confirmation pending is not an error: the account exists,
          // there is just no session until the inbox link is used.
          if (result.emailConfirmationPending) {
            set({ busy: false, error: null, confirmationPending: true });
            return false;
          }
          set({
            busy: false,
            error: result.error ?? "Could not create the account.",
            serverOnline: result.code !== "SERVER_UNREACHABLE",
          });
          return false;
        }
        set({
          account: { ...result.account, guest: false },
          mode: "signed-in",
          busy: false,
          error: null,
          serverOnline: true,
          lockArmed: false,
          restored: true,
        });
        return true;
      },

      signOut: async () => {
        const current = get().account;
        // Guests have no server session to end; registered accounts do.
        if (current && !current.guest) await endSession();
        set({ account: null, mode: "none", lockArmed: false, error: null });
      },

      startGuestSession: () => {
        const existing = get().account;
        const account = existing?.guest ? existing : guestProfileTemplate();
        set({ account, mode: "guest", lockArmed: false, error: null });
      },

      ensureGuestProfile: () => {
        const existing = get().account;
        if (existing?.guest) return existing;
        const account = guestProfileTemplate();
        set({ account, mode: "guest" });
        return account;
      },

      updateProfile: async (patch) => {
        const current = get().account;
        if (!current) return false;
        if (current.guest) {
          set({ account: { ...current, ...patch }, error: null });
          return true;
        }
        // Only these fields are ever sent. A friend code cannot be part of a
        // patch: the server rejects the field outright and there is no code
        // path here that could build one.
        const next = { ...current, ...patch };
        const result = await updateAccount({
          username: next.username,
          displayName: next.displayName,
          bio: next.bio,
          avatar: next.avatar ?? null,
        });
        if (!result.ok || !result.account) {
          set({ error: result.error ?? "Could not save the profile." });
          return false;
        }
        set({ account: { ...result.account, guest: false }, error: null, serverOnline: true });
        return true;
      },

      removeAccount: async (password) => {
        const current = get().account;
        if (!current) return false;
        if (current.guest) {
          set({ account: null, mode: "none", lockArmed: false });
          return true;
        }
        const result = await deleteAccount(password);
        if (!result.ok) {
          set({ error: result.error ?? "Could not delete the account." });
          return false;
        }
        set({ account: null, mode: "none", lockArmed: false, error: null });
        return true;
      },

      setAvatar: (avatar) => {
        const current = get().account;
        if (!current) return;
        const next = { ...current, avatar };
        set({ account: next });
        if (!current.guest) void get().updateProfile({ avatar });
      },

      clearError: () => set({ error: null, confirmationPending: false }),
    }),
    {
      name: "auth",
      // v2: accounts moved to the server. A v1 record was a local-only profile
      // with a browser-generated friend code, which is not an identity any
      // more, so it is dropped rather than presented as one.
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<AuthState> | undefined;
        if (version < 2) {
          // v1 held a browser-local profile with a browser-generated friend
          // code. That is not an identity any more; sign in again.
          return { ...state, account: null, mode: "none" } as AuthState;
        }
        return state as AuthState;
      },
      storage: jsonStorageFor<AuthState>(),
      partialize: (state) => ({ account: state.account, mode: state.mode }) as AuthState,
    },
  ),
);
