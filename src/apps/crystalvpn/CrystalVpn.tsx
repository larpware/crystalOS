import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Field, PasswordInput, Row, Section, Select, Spinner, Switch, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify } from "@/services/os";
import { deriveCoverage, protectionLabel, type PathProtection } from "@/services/vpn/coverage";
import { useNetworkStatus } from "@/hooks/useNetwork";
import { useBrowserStore } from "@/state/browser";
import { useSystemStore } from "@/state/system";
import { useVpnStore } from "@/state/vpn";
import type { VpnEndpointSummary } from "@/services/vpn/types";
import type { AppProps } from "@/types";

/* ==========================================================================
   CrystalVPN

   The VPN the CrystalOS Browser integrates with by default. It drives the
   account-free provider in `server/vpn/controller.mjs`: an authenticated HTTPS
   (or plain HTTP) CONNECT proxy. There is no account, no session and no
   credential minting — the user names an endpoint, or lets Quick connect find
   one, and CrystalOS speaks CONNECT to it.

   The transport is an ordinary HTTP proxy with Basic credentials, the same thing
   a browser's own proxy setting points at. Nothing here is vendor-specific: no
   third party's client, API or account is involved, so there is nothing to be
   granted, revoked or licensed. The exits are public proxies plus any endpoint
   the user supplies — and because a public exit is unaccountable, the app says
   so plainly instead of implying privacy it cannot provide.

   Every control calls the backend and renders what it answered:

     • Test connection runs a real CONNECT through the endpoint and reports the
       proxy's own reply — this is the app's "server list": an endpoint *is* the
       server, so there is no catalogue to fetch.
     • Connect proves the tunnel, then measures the exit address if a check URL
       was supplied, and never claims a check it could not complete.
     • Nothing shows an address, a country, a latency or a throughput that was
       not measured.
   ========================================================================== */

const BLANK = {
  name: "",
  scheme: "https",
  host: "",
  port: "",
  username: "",
  password: "",
  checkUrl: "",
};

/*
 * The host each search engine is reached at.
 *
 * Passed to the backend as a discovery "canary": public proxies frequently
 * connect to *something* while silently black-holing the site you actually want,
 * and a search box that black-holes is a blank page. Preferring an exit that can
 * reach the search engine is what keeps search working through the VPN.
 */
const SEARCH_HOSTS: Record<string, string> = {
  duckduckgo: "duckduckgo.com",
  google: "www.google.com",
  bing: "www.bing.com",
  wikipedia: "www.wikipedia.org",
};

export function CrystalVpn({ args }: AppProps) {
  const snapshot = useVpnStore((state) => state.snapshot);
  const reachable = useVpnStore((state) => state.reachable);
  const transportError = useVpnStore((state) => state.transportError);
  const busy = useVpnStore((state) => state.busy);
  const saveEndpoint = useVpnStore((state) => state.saveEndpoint);
  const clearEndpoint = useVpnStore((state) => state.clearEndpoint);
  const testEndpoint = useVpnStore((state) => state.testEndpoint);
  const endpointTest = useVpnStore((state) => state.endpointTest);
  const connect = useVpnStore((state) => state.connect);
  const quickConnect = useVpnStore((state) => state.quickConnect);
  const disconnect = useVpnStore((state) => state.disconnect);
  const reconnect = useVpnStore((state) => state.reconnect);
  const verify = useVpnStore((state) => state.verify);
  const setEnforce = useVpnStore((state) => state.setEnforce);
  const countries = useVpnStore((state) => state.countries);
  const loadCountries = useVpnStore((state) => state.loadCountries);

  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const browserProxyMode = useBrowserStore((state) => state.proxyMode);
  const searchEngine = useBrowserStore((state) => state.searchEngine);
  const network = useNetworkStatus();

  const [form, setForm] = useState(BLANK);
  const [message, setMessage] = useState<string | null>(null);
  /** The exit the user picked. Empty string is the backend's "fastest anywhere". */
  const [country, setCountry] = useState("");

  const stored = snapshot?.endpoint ?? null;
  const browserUsingProxy = browserProxyMode === "inherit" ? proxyEnabled : browserProxyMode === "on";

  const coverage = useMemo(
    () =>
      deriveCoverage({
        snapshot,
        scramjetEnabled: proxyEnabled,
        browserUsingProxy,
        controllerUnreachable: !reachable,
      }),
    [snapshot, proxyEnabled, browserUsingProxy, reachable],
  );

  /*
   * Seed the non-secret fields from the stored endpoint.
   *
   * The username, the password and the exit-check URL are never returned by any
   * API, so they cannot be filled in — pretending otherwise would make it look
   * as though CrystalOS can read credentials back. The effect keys on the stored
   * identity, so a settings poll does not clobber what the user is typing.
   */
  useEffect(() => {
    if (!stored) return;
    setForm((previous) => ({
      ...previous,
      name: stored.name,
      scheme: stored.scheme,
      host: stored.host,
      port: String(stored.port),
    }));
  }, [stored?.host, stored?.port, stored?.scheme, stored?.name]);

  // The picker's list is static on the backend; load it once per app open.
  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  /** The search engine the browser is set to, as a discovery canary host. */
  const canary = useMemo(() => {
    const host = SEARCH_HOSTS[searchEngine];
    return host ? [host] : [];
  }, [searchEngine]);

  const status = snapshot?.status ?? null;
  const connected = status === "connected";
  const working =
    busy === "connect" || busy === "reconnect" || busy === "disconnect" || busy === "quick";
  const busyEndpoint = busy === "endpoint" || busy === "test";
  const canTurnOff = !connected && snapshot?.enabled === true;
  const countryLabel = countries.find((entry) => entry.code === country)?.name ?? country;
  const countryOptions =
    countries.length > 0
      ? countries.map((entry) => ({ value: entry.code, label: entry.name }))
      : [{ value: "", label: "Fastest anywhere" }];
  // With a stored endpoint and no country picked, the primary action connects
  // through it; otherwise it is the zero-config action, scoped to the country.
  const usesStoredEndpoint = Boolean(stored) && country === "";
  const primaryLabel = connected
    ? "Disconnect"
    : canTurnOff
      ? "Turn off VPN"
      : usesStoredEndpoint
        ? "Connect"
        : country === ""
          ? "Quick connect"
          : `Connect to ${countryLabel}`;
  const primaryIcon = connected || canTurnOff ? "wifi-off" : usesStoredEndpoint ? "shield" : "sparkle";

  /** The backend replaces the whole endpoint on save, so the form must be complete. */
  const credentialsMissing = Boolean(stored?.authenticated && !form.username.trim());
  const canSave = form.host.trim().length > 0 && !credentialsMissing && !busyEndpoint;

  const update = (key: keyof typeof BLANK) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const onSave = async () => {
    setMessage(null);
    const result = await saveEndpoint({
      name: form.name.trim() || form.host.trim(),
      scheme: form.scheme,
      host: form.host.trim(),
      port: form.port.trim() || undefined,
      username: form.username,
      password: form.password,
      checkUrl: form.checkUrl.trim() || undefined,
    });
    if (!result.ok) {
      setMessage(result.message ?? "That endpoint was rejected.");
      return;
    }
    // A saved endpoint makes the manual provider active (the backend does
    // this), and the secrets are handed over, so the form forgets them.
    setForm((previous) => ({ ...previous, username: "", password: "" }));
    setMessage("Endpoint stored. Credentials are held by the backend, never read back into this page.");
  };

  const onTest = async () => {
    setMessage(null);
    await testEndpoint({
      scheme: form.scheme,
      host: form.host.trim(),
      port: form.port.trim() || undefined,
      username: form.username,
      password: form.password,
      name: form.name.trim() || form.host.trim(),
      checkUrl: form.checkUrl.trim() || undefined,
    });
  };

  const onClear = async () => {
    setMessage(null);
    await clearEndpoint();
    setForm(BLANK);
    notify({ title: "Endpoint removed", body: "Quick connect will pick a proxy again.", icon: "shield" });
  };

  const onPrimary = async () => {
    if (working) return;
    if (connected || canTurnOff) {
      const next = await disconnect();
      if (next) notify({ title: "VPN disconnected", body: "Proxied browsing is unprotected again.", icon: "shield" });
      return;
    }
    // Saving an endpoint selects the manual provider; make sure a stale
    // provider selection cannot make this button connect through something
    // else.
    if (snapshot?.provider !== "manual") {
      await useVpnStore.getState().setProvider();
    }
    const next = await connect();
    if (!next) return;
    if (next.status === "connected") {
      notify({
        title: "VPN connected",
        body: next.server ? `Proxied browsing now exits through ${next.server.name}.` : "Proxied browsing is protected.",
        icon: "shield",
      });
      return;
    }
    notify({
      title: "VPN could not connect",
      body: next.error?.message ?? "The connection attempt did not succeed.",
      icon: "warning",
    });
  };

  /*
   * The zero-config action: the backend finds a working public proxy itself —
   * optionally restricted to the country the user picked — prefers one that can
   * reach the search engine, stores it and connects. The reply is the same shape
   * a manual connect returns, so the same notifications apply — including the
   * honest one when nothing was found.
   */
  const onQuick = async () => {
    if (working) return;
    const next = await quickConnect({ country: country || undefined, canary });
    if (!next) return;
    if (next.status === "connected") {
      const where = next.server?.proxyHost
        ? `Proxied browsing now exits through ${next.server.proxyHost}:${next.server.proxyPort}`
        : "Proxied browsing is protected";
      notify({
        title: country ? `VPN connected · ${countryLabel}` : "VPN connected",
        body: `${where}.`,
        icon: "shield",
      });
      return;
    }
    notify({
      title: "No free server found",
      body: next.error?.message ?? "No public proxy accepted a connection. Try again in a moment.",
      icon: "warning",
    });
  };

  if (!reachable && !snapshot) {
    return (
      <div className="cr-vpn" data-status="unknown">
        <EmptyState
          icon="warning"
          title="The VPN backend is not answering"
          hint={
            transportError ??
            "The CrystalVPN controller runs in the CrystalOS backend. Start it with `npm run dev:all` (or `npm run scramjet`), then reopen this window."
          }
        />
      </div>
    );
  }

  return (
    <div className="cr-vpn" data-status={status ?? "unknown"}>
      <header className="cr-vpn__hero">
        <div className="cr-vpn__hero-main">
          <span className="cr-vpn__shield" data-on={connected}>
            <Icon name="shield" size={26} />
          </span>
          <div className="cr-vpn__hero-text">
            <h2 className="cr-vpn__hero-title">{coverage.headline}</h2>
            <p className="cr-vpn__hero-sub">
              {connected && snapshot?.server
                ? `${snapshot.server.name} · ${snapshot.server.proxyHost}:${snapshot.server.proxyPort}${snapshot.server.exitCountry ? ` · ${snapshot.server.exitCountry}` : ""}`
                : stored
                  ? country
                    ? `Picked ${countryLabel} — Connect to switch the exit, or Clear endpoint to go automatic.`
                    : "CrystalVPN's account-free proxy transport, applied to CrystalOS's Scramjet traffic."
                  : country
                    ? `Exit through ${countryLabel} — CrystalOS finds a working public proxy for you.`
                    : "Pick a country or leave it anywhere — CrystalOS finds a working public proxy for you."}
            </p>
          </div>
        </div>

          <div className="cr-vpn__hero-actions">
            {working && <Spinner label={busy === "quick" ? "Finding a server" : "Working"} />}
          <Select
            className="cr-vpn__country"
            value={country}
            disabled={working || connected}
            aria-label="Exit country"
            title="Choose the country your browsing exits from"
            onChange={(event) => setCountry(event.target.value)}
            options={countryOptions}
          />
          <Button
            variant={connected || canTurnOff ? "default" : "primary"}
            size="lg"
            icon={primaryIcon}
            disabled={working}
            onClick={() => void (connected || canTurnOff || usesStoredEndpoint ? onPrimary() : onQuick())}
          >
            {busy === "quick"
              ? "Finding a server…"
              : busy === "connect"
                ? "Connecting…"
                : busy === "disconnect"
                  ? "Disconnecting…"
                  : primaryLabel}
          </Button>
          {connected && (
            <Button icon="refresh" disabled={working} onClick={() => void reconnect()}>
              Reconnect
            </Button>
          )}
        </div>
      </header>

      {!network.online && (
        <p className="cr-vpn__banner" data-tone="warning">
          <Icon name="wifi-off" size={14} />
          This device reports no network connection, so a connection attempt will fail.
        </p>
      )}

      {snapshot?.error && (
        <p className="cr-vpn__banner" data-tone="danger">
          <Icon name="warning" size={14} />
          <span>
            <strong>{snapshot.error.code}</strong> — {snapshot.error.message}
          </span>
        </p>
      )}

      {canTurnOff && (
        <p className="cr-vpn__banner" data-tone="danger">
          <Icon name="shield" size={14} />
          <span>
            The VPN is on but not connected, so CrystalOS is refusing proxied requests rather than sending them
            unprotected. Use <strong>{primaryLabel}</strong> to browse unprotected again, or connect once the endpoint
            works.
          </span>
        </p>
      )}

      {!reachable && transportError && (
        <p className="cr-vpn__banner" data-tone="danger">
          <Icon name="warning" size={14} />
          Lost contact with the VPN backend: {transportError}
        </p>
      )}

      <EndpointSection
        form={form}
        update={update}
        stored={stored}
        message={message}
        test={endpointTest}
        credentialsMissing={credentialsMissing}
        canSave={canSave}
        busyEndpoint={busyEndpoint}
        testing={busy === "test"}
        saving={busy === "endpoint"}
        onSave={() => void onSave()}
        onTest={() => void onTest()}
        onClear={() => void onClear()}
      />

      <ProtectionSection
        coverage={coverage}
        enforce={snapshot?.enforce ?? true}
        proxyEnabled={proxyEnabled}
        onEnforce={(value) => void setEnforce(value)}
        disabled={busy === "enforce"}
      />

      <VerificationSection
        snapshot={snapshot}
        connected={connected}
        onVerify={() => void verify()}
        busy={busy === "verify"}
      />

      <HowItWorksSection />

      {typeof args?.section === "string" && (
        <p className="cr-vpn__foot-note">Opened from Settings → {args.section}.</p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- endpoint */

function EndpointSection({
  form,
  update,
  stored,
  message,
  test,
  credentialsMissing,
  canSave,
  busyEndpoint,
  testing,
  saving,
  onSave,
  onTest,
  onClear,
}: {
  form: typeof BLANK;
  update: (key: keyof typeof BLANK) => (value: string) => void;
  stored: VpnEndpointSummary | null;
  message: string | null;
  test: ReturnType<typeof useVpnStore.getState>["endpointTest"];
  credentialsMissing: boolean;
  canSave: boolean;
  busyEndpoint: boolean;
  testing: boolean;
  saving: boolean;
  onSave: () => void;
  onTest: () => void;
  onClear: () => void;
}) {
  return (
    <Section
      title="CrystalVPN endpoint"
      description="The proxy CrystalOS tunnels through — a host, a port and optional Basic credentials, the same transport the CrystalVPN extension uses. Leave it empty and press Quick connect to have CrystalOS find a working public proxy for you."
    >
      {stored && (
        <p className="cr-vpn__note" data-tone="info">
          Stored endpoint: <strong>{stored.name}</strong> — {stored.scheme}://{stored.host}:{stored.port}
          {stored.authenticated ? " (credentials stored)" : ""}
          {stored.hasCheckUrl ? " · exit check configured" : ""}. Credentials and the check URL are never read back into
          this page.
        </p>
      )}

      {/* Two fields to a line. Seven full-width inputs, each with a hint under
          it, read as a column of prose rather than a form. */}
      <div className="cr-vpn__form-grid">
        <Field label="Name">
          <TextInput
            value={form.name}
            placeholder="CrystalVPN — Frankfurt"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => update("name")(event.target.value)}
          />
        </Field>

        <Field label="Scheme" hint="HTTPS proxy, or http for a plain one.">
          <Select
            aria-label="Proxy scheme"
            value={form.scheme}
            options={[
              { value: "https", label: "https — a TLS proxy" },
              { value: "http", label: "http — a plain proxy" },
            ]}
            onChange={(event) => update("scheme")(event.target.value)}
          />
        </Field>

        <Field label="Host" hint="A host or IP, not a URL.">
          <TextInput
            value={form.host}
            placeholder="proxy.example.com"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => update("host")(event.target.value)}
          />
        </Field>

        <Field label="Port" hint="Blank uses 443, or 80 for http.">
          <TextInput
            value={form.port}
            placeholder="443"
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => update("port")(event.target.value)}
          />
        </Field>

        <Field
          label="Username"
          hint={
            credentialsMissing
              ? "Stored credentials cannot be read back — enter the username again to keep them."
              : "Blank for a proxy that wants no credentials."
          }
        >
          <TextInput
            value={form.username}
            autoComplete="off"
            onChange={(event) => update("username")(event.target.value)}
          />
        </Field>

        <Field label="Password">
          <PasswordInput
            value={form.password}
            autoComplete="off"
            onChange={(event) => update("password")(event.target.value)}
          />
        </Field>

        <div className="cr-vpn__form-wide">
          <Field
            label="Exit check URL (optional)"
            hint="A plain http:// address that returns your address. CrystalOS reads it directly and through the tunnel to prove the exit changed."
          >
            <TextInput
              value={form.checkUrl}
              placeholder="http://check.example.net/ip"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => update("checkUrl")(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {message && (
        <p className="cr-vpn__note" data-tone="info">
          {message}
        </p>
      )}

      {test && (
        <p className="cr-vpn__banner" data-tone={test.ok ? "info" : "warning"}>
          <Icon name={test.ok ? "check" : "warning"} size={14} />
          <span>
            {test.ok ? `Endpoint accepted a CONNECT in ${test.ms} ms. ` : "The test did not succeed. "}
            {test.detail}
          </span>
        </p>
      )}

      <div className="cr-vpn__form-actions">
        <Button variant="primary" icon="check" disabled={!canSave} onClick={onSave}>
          {saving ? "Saving…" : "Save endpoint"}
        </Button>
        <Button icon="activity" disabled={!canSave} onClick={onTest}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {stored && (
          <Button icon="trash" disabled={busyEndpoint} onClick={onClear}>
            Remove
          </Button>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- protection */

const PATH_ROWS: { key: keyof ReturnType<typeof deriveCoverage>; label: string; note: string }[] = [
  {
    key: "scramjet",
    label: "Scramjet traffic",
    note: "Pages and applications CrystalOS loads through its Wisp transport. The backend dials these, so the tunnel covers them.",
  },
  {
    key: "browserTabs",
    label: "CrystalOS Browser tabs",
    note: "Protected while a tab is using Scramjet. A tab loaded directly is fetched by this browser page and cannot be tunnelled.",
  },
  {
    key: "shellRequests",
    label: "Shell's own requests",
    note: "Favicon images and similar page-origin requests. A web page cannot set a proxy, so these always leave directly.",
  },
  {
    key: "hostApplications",
    label: "The rest of the device",
    note: "Your own browser tabs and other applications. A web application cannot redirect traffic it does not make.",
  },
];

function toneFor(protection: PathProtection): "success" | "danger" | "warning" | "default" {
  if (protection === "protected") return "success";
  if (protection === "blocked") return "danger";
  if (protection === "unprotected") return "warning";
  return "default";
}

function ProtectionSection({
  coverage,
  enforce,
  proxyEnabled,
  onEnforce,
  disabled,
}: {
  coverage: ReturnType<typeof deriveCoverage>;
  enforce: boolean;
  proxyEnabled: boolean;
  onEnforce: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <Section
      title="What is protected"
      description="CrystalOS reports each traffic path separately. Connecting to CrystalVPN does not make the paths below equal, so they are not shown as one switch."
    >
      {PATH_ROWS.map((row) => {
        const protection = coverage[row.key] as PathProtection;
        return (
          <Row
            key={row.key}
            label={row.label}
            description={row.note}
            control={<Badge tone={toneFor(protection)}>{protectionLabel(protection)}</Badge>}
          />
        );
      })}

      <Row
        label="Block unprotected traffic"
        description={
          enforce
            ? "While the VPN is wanted but not connected, CrystalOS refuses proxied requests instead of sending them directly."
            : "Unprotected traffic is allowed while the VPN is not connected. CrystalOS will say so rather than claim protection."
        }
        control={<Switch label="Block unprotected traffic" checked={enforce} disabled={disabled} onChange={onEnforce} />}
      />

      <Row
        label="Scramjet proxy"
        description={
          proxyEnabled
            ? "On. This is the path the VPN protects."
            : "Off. With Scramjet off, CrystalOS Browser loads pages itself, and no server-side tunnel can reach that traffic."
        }
        control={<Badge tone={proxyEnabled ? "success" : "warning"}>{proxyEnabled ? "On" : "Off"}</Badge>}
      />
    </Section>
  );
}

/* ----------------------------------------------------------- verification */

function VerificationSection({
  snapshot,
  connected,
  onVerify,
  busy,
}: {
  snapshot: ReturnType<typeof useVpnStore.getState>["snapshot"];
  connected: boolean;
  onVerify: () => void;
  busy: boolean;
}) {
  const tunnel = snapshot?.verified.tunnel ?? null;
  const egress = snapshot?.verified.egress ?? null;

  return (
    <Section
      title="Verification"
      description="Two independent checks. Neither is a claim about DNS, IPv6 or every possible leak — only about what was actually measured."
    >
      <Row
        label="CONNECT tunnel"
        description={
          tunnel
            ? tunnel.detail
            : "Not established. This check proves the endpoint accepted a CONNECT for CrystalOS."
        }
        control={<Badge tone={tunnel?.ok ? "success" : "default"}>{tunnel?.ok ? "Confirmed" : "Not yet"}</Badge>}
      />

      <Row
        label="Exit address"
        description={
          egress
            ? egress.conclusive
              ? egress.ok
                ? `Traffic through the tunnel exits from ${egress.exitIp}${egress.country ? ` (${egress.country})` : ""} — different from this machine's own address (${egress.directIp}).`
                : (egress.reason ?? "The tunnel exits from this machine's own address.")
              : `Not verified: ${egress.reason ?? "the check could not be completed."}`
            : "Not checked yet. With no exit-check URL this stays unknown rather than claiming a pass."
        }
        control={
          <>
            <Badge tone={egress?.ok ? "success" : egress?.conclusive ? "danger" : "default"}>
              {egress ? (egress.conclusive ? (egress.ok ? "Verified" : "Failed") : "Unknown") : "Not checked"}
            </Badge>
            <Button size="sm" icon="activity" disabled={!connected || busy} onClick={onVerify}>
              {busy ? "Checking…" : "Check exit address"}
            </Button>
          </>
        }
      />
    </Section>
  );
}

/* ------------------------------------------------------------ how it works */

function HowItWorksSection() {
  return (
    <details className="cr-vpn__more">
      <summary>How this works</summary>
      <p className="cr-vpn__note">
        The transport, stated plainly. Eight paragraphs of detail is reference material, so it folds
        away until it is asked for.
      </p>

      <ul className="cr-vpn__list">
        <li>
          <strong>Quick connect</strong> fetches public lists of free HTTP proxies, proves each
          candidate with a real CONNECT, and dials the fastest working one — so no server has to be
          configured. A saved endpoint is used as-is instead, so your own choice is never discarded.
        </li>
        <li>
          Those public proxies are unaccountable, so treat them as a convenience, not privacy: a
          hostile exit can see <em>which</em> hosts you visit. CrystalOS still opens opaque CONNECT
          tunnels, so a site's own TLS is never readable or forgeable by the exit. For anything
          sensitive, use an endpoint you control.
        </li>
        <li>
          CrystalVPN reaches sites through an authenticated proxy — the same mechanism its browser extension uses, with the
          endpoint, port and Basic credentials it issues. CrystalOS speaks that transport from its backend.
        </li>
        <li>
          The tunnel is applied in CrystalOS's backend, because that is where proxied traffic actually leaves from — the
          Scramjet worker hands the request to CrystalOS's Wisp transport, which dials the socket.
        </li>
        <li>
          No account, session or vendor API is involved: the endpoint you enter <em>is</em> the configuration. That is
          why there is no server list — there is no catalogue to fetch.
        </li>
        <li>
          The tunnel to an https endpoint is certificate-verified, and end-to-end TLS to each site stays intact:
          CrystalOS never terminates or inspects that session.
        </li>
        <li>
          CrystalVPN's paid tier is an entitlement its server issues, not a switch in a client. This app therefore drives the
          free, account-free transport honestly; it does not unlock premium features and does not pretend to.
        </li>
        <li>
          No host-wide network setting is touched: no system proxy, no routes, no DNS, no certificates in the host trust
          store.
        </li>
      </ul>
    </details>
  );
}

export default CrystalVpn;
