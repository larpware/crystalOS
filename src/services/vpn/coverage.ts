/* ==========================================================================
   VPN coverage

   The single place that decides what CrystalOS is allowed to *claim* about each
   traffic path. It is a pure function of two inputs — what the backend
   controller reports, and which of CrystalOS's own switches are on — so the
   Browser, the VPN app, Quick settings and Settings cannot disagree, and so the
   rule can be tested without a browser or a network.

   The paths, and why each one is what it is:

     • `scramjet` — pages loaded through Scramjet. The service worker hands these
       to the Wisp WebSocket, and the backend dials them, so the backend's tunnel
       is what protects them. This is the one path that is genuinely protected.

     • `browserTabs` — what CrystalOS Browser's tabs are actually showing. If the
       tab is in Scramjet it inherits the path above; a tab loaded directly by
       this window is fetched by the *browser*, which no server-side tunnel can
       reach. Calling that protected would be false.

     • `shellRequests` — the shell's own page-origin requests (favicon images, a
       page fetched by the download button). They leave from the browser too, and
       are never protected, whatever the VPN is doing.

     • `hostApplications` — the user's own browser tabs and other applications.
       Out of scope by design: CrystalOS is a web application, and a web page
       cannot redirect traffic it does not make.
   ========================================================================== */

import type { VpnSnapshot, VpnStatus } from "./types";

export type PathProtection =
  /** Traffic on this path really does leave through the VPN. */
  | "protected"
  /** Traffic on this path leaves unprotected. */
  | "unprotected"
  /** The path is being refused rather than sent unprotected (fail closed). */
  | "blocked"
  /** The path is not in use, so there is nothing to protect. */
  | "disabled"
  /** Outside CrystalOS's boundary entirely. */
  | "out-of-scope";

export interface VpnCoverage {
  scramjet: PathProtection;
  browserTabs: PathProtection;
  shellRequests: PathProtection;
  hostApplications: PathProtection;
  /** True when at least one path really is protected. */
  anyProtected: boolean;
  /** One sentence for a status bar or a notification. */
  headline: string;
}

export interface CoverageInput {
  snapshot: VpnSnapshot | null;
  /** The OS-wide Scramjet switch (`useSystemStore().proxyEnabled`). */
  scramjetEnabled: boolean;
  /** Whether CrystalOS Browser's tabs are using the proxy right now. */
  browserUsingProxy: boolean;
  /** Set when the backend itself could not be reached. */
  controllerUnreachable?: boolean;
}

/** True when the VPN is wanted and is allowed to refuse unprotected traffic. */
export function isEnforcing(snapshot: VpnSnapshot | null): boolean {
  return Boolean(snapshot?.enabled && snapshot?.enforce);
}

/**
 * The provider's display name.
 *
 * CrystalVPN is the only VPN shipped with CrystalOS. The snapshot's provider
 * field is an internal transport detail now, so every surface uses one name.
 */
export function providerName(_snapshot: VpnSnapshot | null): string {
  return "CrystalVPN";
}

/** The application that configures the VPN. */
export function providerAppId(_snapshot: VpnSnapshot | null): "crystalvpn" {
  return "crystalvpn";
}

/**
 * True while the shell must not offer a way to load a page outside the tunnel.
 *
 * Used by the Browser to withhold direct mode: with the VPN wanted and
 * enforcement on, "load without the proxy" is a request to send traffic
 * unprotected, and the user asked for the opposite.
 */
export function isVpnLocked(snapshot: VpnSnapshot | null): boolean {
  return isEnforcing(snapshot) && snapshot?.status !== "connected";
}

export function deriveCoverage({
  snapshot,
  scramjetEnabled,
  browserUsingProxy,
  controllerUnreachable = false,
}: CoverageInput): VpnCoverage {
  const status: VpnStatus | null = snapshot?.status ?? null;
  const connected = status === "connected";
  const enforcing = isEnforcing(snapshot);

  let scramjet: PathProtection;
  if (!scramjetEnabled) scramjet = "disabled";
  else if (connected) scramjet = "protected";
  else if (enforcing) scramjet = "blocked";
  else scramjet = "unprotected";

  const browserTabs: PathProtection = !browserUsingProxy
    ? "unprotected"
    : !scramjetEnabled
      ? "disabled"
      : scramjet;

  const anyProtected = scramjet === "protected";

  return {
    scramjet,
    browserTabs,
    // Stated rather than derived: these never become protected, so they must not
    // be able to look protected when the VPN is on.
    shellRequests: controllerUnreachable ? "out-of-scope" : "unprotected",
    hostApplications: "out-of-scope",
    anyProtected,
    headline: headlineFor({ status, scramjet, controllerUnreachable, snapshot }),
  };
}

function headlineFor({
  status,
  scramjet,
  controllerUnreachable,
  snapshot,
}: {
  status: VpnStatus | null;
  scramjet: PathProtection;
  controllerUnreachable: boolean;
  snapshot: VpnSnapshot | null;
}): string {
  if (controllerUnreachable) return "VPN backend unreachable";
  if (status === "connected") {
    return scramjet === "protected" ? "Proxied browsing is protected" : "Connected — proxy is off";
  }
  if (status === "connecting") return `Connecting to ${providerName(snapshot)}`;
  if (status === "reconnecting") return `Reconnecting to ${providerName(snapshot)}`;
  if (status === "disconnecting") return "Disconnecting";
  if (status === "error") return snapshot?.error?.message ?? "VPN error";
  if (status === "unsupported") return "Not supported on this runtime";
  if (isEnforcing(snapshot)) return "VPN on, not connected — traffic is being blocked";
  return "VPN off";
}

/** Short label for a status pill. Never says "protected" unless it is. */
export function protectionLabel(protection: PathProtection): string {
  switch (protection) {
    case "protected":
      return "Protected";
    case "blocked":
      return "Blocked";
    case "disabled":
      return "Not in use";
    case "out-of-scope":
      return "Outside CrystalOS";
    default:
      return "Unprotected";
  }
}
