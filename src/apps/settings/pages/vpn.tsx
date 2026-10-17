import { Badge, Button, Row, Section, Switch } from "@/components/ui";
import { openApp } from "@/services/os";
import { deriveCoverage, protectionLabel, providerName } from "@/services/vpn/coverage";
import { useBrowserStore } from "@/state/browser";
import { useSystemStore } from "@/state/system";
import { useVpnStore } from "@/state/vpn";

/* ==========================================================================
   Settings → VPN

   Deliberately a summary, not a second control room. Connecting, choosing a
   server or endpoint and verifying the exit involve explanations that need the
   room the VPN app has, so this page reports the state, exposes the one setting
   that is a plain toggle, and hands off to the app that owns the connection.
   Two places that both "connect" would eventually disagree; one place that
   connects and one that describes it cannot.
   ========================================================================== */

export function VpnPage() {
  const snapshot = useVpnStore((state) => state.snapshot);
  const reachable = useVpnStore((state) => state.reachable);
  const busy = useVpnStore((state) => state.busy);
  const setEnforce = useVpnStore((state) => state.setEnforce);
  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const browserProxyMode = useBrowserStore((state) => state.proxyMode);

  const coverage = deriveCoverage({
    snapshot,
    scramjetEnabled: proxyEnabled,
    browserUsingProxy: browserProxyMode === "inherit" ? proxyEnabled : browserProxyMode === "on",
    controllerUnreachable: !reachable && snapshot === null,
  });

  const name = providerName(snapshot);
  const endpoint = snapshot?.endpoint ?? null;

  return (
    <>
      <Section
        title={name}
        description="The connection lives in the CrystalOS backend, which is where proxied traffic leaves from. This page reports it."
      >
        <Row
          label="Status"
          description={coverage.headline}
          control={
            <Badge
              tone={
                snapshot?.status === "connected"
                  ? "success"
                  : snapshot?.status === "error"
                    ? "danger"
                    : "default"
              }
              icon="shield"
            >
              {snapshot?.status ?? (reachable ? "unknown" : "backend unreachable")}
            </Badge>
          }
        />

        <Row
          label="Endpoint"
          description={
            endpoint
              ? `${endpoint.name} — ${endpoint.scheme}://${endpoint.host}:${endpoint.port}`
              : "No endpoint configured yet. Open CrystalVPN and press Quick connect to pick one automatically."
          }
          control={
            endpoint ? (
              <Badge tone={endpoint.authenticated ? "success" : "default"}>
                {endpoint.authenticated ? "Authenticated" : "No credentials"}
              </Badge>
            ) : (
              <Button size="sm" variant="primary" icon="shield" onClick={() => openApp("crystalvpn")}>
                Set up CrystalVPN
              </Button>
            )
          }
        />

        {snapshot?.server && (
          <Row
            label="Connected exit"
            description={`${snapshot.server.name}${
              snapshot.server.exitCountry ? `, ${snapshot.server.exitCountry}` : ""
            }`}
            control={
              snapshot.server.proxyHost ? (
                <Badge tone="accent">{`${snapshot.server.proxyHost}:${snapshot.server.proxyPort}`}</Badge>
              ) : null
            }
          />
        )}
      </Section>

      <Section
        title="Protection"
        description="Which traffic paths a connection actually covers. They differ, so they are listed rather than summarised."
      >
        <Row
          label="Scramjet traffic"
          description="Pages loaded through CrystalOS's Wisp transport."
          control={<Badge tone={tone(coverage.scramjet)}>{protectionLabel(coverage.scramjet)}</Badge>}
        />
        <Row
          label="Browser tabs"
          description="CrystalOS Browser's own tabs."
          control={<Badge tone={tone(coverage.browserTabs)}>{protectionLabel(coverage.browserTabs)}</Badge>}
        />
        <Row
          label="Shell requests"
          description="Page-origin requests the shell itself makes."
          control={<Badge tone={tone(coverage.shellRequests)}>{protectionLabel(coverage.shellRequests)}</Badge>}
        />
        <Row
          label="Other applications"
          description="Your own browser tabs and other apps."
          control={<Badge tone={tone(coverage.hostApplications)}>{protectionLabel(coverage.hostApplications)}</Badge>}
        />

        <Row
          label="Block unprotected traffic"
          description="While the VPN is wanted and not connected, refuse proxied requests instead of sending them directly."
          control={
            <Switch
              label="Block unprotected traffic"
              checked={snapshot?.enforce ?? true}
              disabled={busy === "enforce"}
              onChange={(value) => void setEnforce(value)}
            />
          }
        />
      </Section>

      <Section
        title="Manage the connection"
        description="Connecting, choosing an endpoint and verifying the exit address all live in the VPN app."
      >
        <Row
          label="CrystalVPN"
          description="Account-free, one-click VPN for CrystalOS. No sign-in, no subscription."
          control={
            <Button variant="primary" icon="shield" onClick={() => openApp("crystalvpn")}>
              Open CrystalVPN
            </Button>
          }
        />
      </Section>
    </>
  );
}

function tone(protection: ReturnType<typeof deriveCoverage>["scramjet"]): "success" | "danger" | "warning" | "default" {
  if (protection === "protected") return "success";
  if (protection === "blocked") return "danger";
  if (protection === "unprotected") return "warning";
  return "default";
}
