import { create } from "zustand";
import {
  clearEndpoint as apiClearEndpoint,
  connect as apiConnect,
  disconnect as apiDisconnect,
  fetchCountries,
  fetchServers,
  fetchStatus,
  quickConnect as apiQuickConnect,
  reconnect as apiReconnect,
  saveEndpoint as apiSaveEndpoint,
  setEnforce as apiSetEnforce,
  setProvider as apiSetProvider,
  testEndpoint as apiTestEndpoint,
  verifyExit,
  type VpnPreference,
} from "@/services/vpn/client";
import type {
  VpnCountry,
  VpnEgressVerification,
  VpnEndpointInput,
  VpnEndpointTest,
  VpnServerSummary,
  VpnSnapshot,
} from "@/services/vpn/types";

/* ==========================================================================
   VPN state (client mirror)

   This store is a *mirror*, not a source of truth. The connection lives in
   `server/vpn/controller.mjs`; this holds the last thing the controller said so
   React can render it, and it never derives a second opinion. There is
   deliberately no `isConnected` setter here, no optimistic "connecting…" state
   and no local boolean that could disagree with the backend — every action
   above calls the backend and then replaces this mirror with the reply.

   It is also not persisted. A VPN connection cannot survive a page reload
   because the process that owns it is the backend's, not this tab's, so
   restoring a stale "connected" from localStorage would be a fabricated state.
   On mount the mirror is simply re-read.
   ========================================================================== */

export type VpnBusy =
  | null
  | "connect"
  | "disconnect"
  | "reconnect"
  | "verify"
  | "servers"
  | "enforce"
  | "provider"
  | "endpoint"
  | "test"
  | "quick";

interface VpnStore {
  /** Last status the controller reported, or null before the first read. */
  snapshot: VpnSnapshot | null;
  /** True once the backend has answered at least once. */
  reachable: boolean;
  /** A transport-level failure (the backend is not answering). */
  transportError: string | null;
  /** Which action is in flight, so buttons can disable honestly. */
  busy: VpnBusy;
  servers: VpnServerSummary[];
  serversNote: string | null;
  /** The countries the exit picker offers. Loaded once from the backend. */
  countries: VpnCountry[];
  /** The last endpoint CONNECT probe, or null before one has run. */
  endpointTest: VpnEndpointTest | null;
  lastSyncedAt: number | null;

  sync: () => Promise<void>;
  connect: (preference?: VpnPreference) => Promise<VpnSnapshot | null>;
  /**
   * Zero-config connect: the backend finds a working public proxy and dials it.
   * `country` picks the exit; `canary` hosts (the search engine) are preferred.
   */
  quickConnect: (options?: { country?: string; canary?: string[] }) => Promise<VpnSnapshot | null>;
  disconnect: () => Promise<VpnSnapshot | null>;
  reconnect: (preference?: VpnPreference) => Promise<VpnSnapshot | null>;
  verify: () => Promise<VpnEgressVerification | null>;
  loadServers: (refresh?: boolean) => Promise<void>;
  loadCountries: () => Promise<void>;
  setEnforce: (enforce: boolean) => Promise<void>;
  /** Selects the account-free provider CrystalVPN drives. */
  setProvider: () => Promise<VpnSnapshot | null>;
  /** Stores a user-supplied proxy endpoint; validation happens in the backend. */
  saveEndpoint: (endpoint: VpnEndpointInput) => Promise<{ ok: boolean; message?: string }>;
  /** Removes the stored endpoint, returning the VPN to automatic selection. */
  clearEndpoint: () => Promise<VpnSnapshot | null>;
  /** Proves an endpoint accepts a CONNECT, without connecting. */
  testEndpoint: (endpoint: VpnEndpointInput) => Promise<VpnEndpointTest | null>;
}

/** Guards against a poll and a click overlapping in flight. */
let inFlightSync = false;

export const useVpnStore = create<VpnStore>()((set, get) => {
  /** Replaces the mirror with the backend's reply, or records unreachability. */
  function apply<T extends VpnSnapshot>(result: { ok: true; data: T } | { ok: false; error: unknown }, fallbackMessage: string) {
    if (result.ok) {
      set({ snapshot: result.data, reachable: true, transportError: null, lastSyncedAt: Date.now() });
      return result.data;
    }
    const error = result.error as { message?: string; offline?: boolean };
    set({
      reachable: false,
      transportError: error?.message ?? fallbackMessage,
    });
    return null;
  }

  /**
   * Reads the controller.
   *
   * A poll that lands while an action is running is skipped rather than queued:
   * the action's own reply is the newer fact, and racing the two would let a
   * stale read overwrite it.
   */
  async function sync() {
    if (inFlightSync || get().busy !== null) return;
    inFlightSync = true;
    try {
      const result = await fetchStatus();
      if (result.ok) {
        set({
          snapshot: result.data,
          reachable: true,
          transportError: null,
          lastSyncedAt: Date.now(),
        });
      } else {
        const error = result.error as { message?: string; offline?: boolean };
        set({ reachable: false, transportError: error?.message ?? "The VPN backend is not answering." });
      }
    } finally {
      inFlightSync = false;
    }
  }

  async function run(action: Exclude<VpnBusy, null>, work: () => Promise<Parameters<typeof apply>[0]>, message: string) {
    set({ busy: action });
    try {
      return apply(await work(), message);
    } finally {
      set({ busy: null });
    }
  }

  return {
    snapshot: null,
    reachable: false,
    transportError: null,
    busy: null,
    servers: [],
    serversNote: null,
    countries: [],
    endpointTest: null,
    lastSyncedAt: null,

    sync,

    connect: (preference) => run("connect", () => apiConnect(preference), "The VPN backend is not answering."),
    quickConnect: (options) =>
      run("quick", () => apiQuickConnect(options), "The VPN backend is not answering."),
    disconnect: () => run("disconnect", () => apiDisconnect(), "The VPN backend is not answering."),
    reconnect: (preference) => run("reconnect", () => apiReconnect(preference), "The VPN backend is not answering."),

    async verify() {
      set({ busy: "verify" });
      try {
        const result = await verifyExit();
        if (!result.ok) {
          const error = result.error as { message?: string; code?: string };
          set({ transportError: error?.message ?? null, reachable: error?.code !== "SERVER_UNREACHABLE" });
          return null;
        }
        set({ snapshot: result.data, reachable: true, transportError: null, lastSyncedAt: Date.now() });
        return result.data.verification;
      } finally {
        set({ busy: null });
      }
    },

    async loadServers(refresh = false) {
      set({ busy: "servers" });
      try {
        const result = await fetchServers(refresh);
        if (!result.ok) {
          set({ serversNote: "The server list could not be loaded." });
          return;
        }
        set({ servers: result.data.servers, serversNote: result.data.reason ?? null });
      } finally {
        set({ busy: null });
      }
    },

    /**
     * Loads the exit-country list once.
     *
     * The list is static on the backend, so a failure is not retried here — the
     * picker simply stays empty and the "Fastest anywhere" default still works.
     */
    async loadCountries() {
      if (get().countries.length > 0) return;
      const result = await fetchCountries();
      if (result.ok) set({ countries: result.data.countries });
    },

    async setEnforce(enforce) {
      set({ busy: "enforce" });
      try {
        apply(await apiSetEnforce(enforce), "The VPN backend is not answering.");
      } finally {
        set({ busy: null });
      }
    },

    async setProvider() {
      set({ busy: "provider" });
      try {
        return apply(await apiSetProvider("manual"), "The VPN backend is not answering.");
      } finally {
        set({ busy: null });
      }
    },

    /**
     * Stores the endpoint and mirrors the backend's answer.
     *
     * A rejected endpoint comes back as a 400 with a message written for the
     * person who typed it, so the message is returned rather than thrown —
     * "that port is out of range" is not an exception, it is a correction.
     */
    async saveEndpoint(endpoint) {
      set({ busy: "endpoint" });
      try {
        const result = await apiSaveEndpoint(endpoint);
        if (!result.ok) {
          const error = result.error as { message?: string };
          return { ok: false, message: error?.message ?? "That endpoint was rejected." };
        }
        set({
          snapshot: result.data,
          reachable: true,
          transportError: null,
          lastSyncedAt: Date.now(),
          // A stored endpoint invalidates any previous test result.
          endpointTest: null,
        });
        return { ok: true };
      } finally {
        set({ busy: null });
      }
    },

    async clearEndpoint() {
      set({ busy: "endpoint" });
      try {
        const snapshot = apply(await apiClearEndpoint(), "The VPN backend is not answering.");
        set({ endpointTest: null });
        return snapshot;
      } finally {
        set({ busy: null });
      }
    },

    async testEndpoint(endpoint) {
      set({ busy: "test" });
      try {
        const result = await apiTestEndpoint(endpoint);
        if (!result.ok) {
          const error = result.error as { message?: string };
          // A validation refusal is still a test outcome, shown in the same
          // place as a proxy refusal so the user never sees a silent no-op.
          const failed: VpnEndpointTest = {
            ok: false,
            ms: 0,
            detail: error?.message ?? "That endpoint could not be tested.",
            checkedAt: Date.now(),
          };
          set({ endpointTest: failed });
          return failed;
        }
        const tested: VpnEndpointTest = { ...result.data, checkedAt: Date.now() };
        set({ endpointTest: tested });
        return tested;
      } finally {
        set({ busy: null });
      }
    },
  };
});

/* ---------------------------------------------------------------- selectors */

export function useVpnSnapshot(): VpnSnapshot | null {
  return useVpnStore((state) => state.snapshot);
}

export function useVpnStatus() {
  const snapshot = useVpnSnapshot();
  return snapshot?.status ?? null;
}

export function useVpnConnected(): boolean {
  return useVpnSnapshot()?.status === "connected";
}
