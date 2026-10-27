import { Badge, Button, Row, Section, Switch } from "@/components/ui";
import { useScramjetState } from "@/services/scramjet/useProxiedFrame";
import { DEFAULT_SHIELD_SETTINGS, SHIELD_LIST_SOURCE, defaultFilterList, updateShieldSettings } from "@/services/shield";
import { useShield } from "@/services/shield/useShield";

/* ==========================================================================
   Settings → Proxy

   Two things live here because they are the same path to a person:

     - what the proxy does with a page's requests, which is where the alpha
       data saver sits, and
     - what Shield does with them, which is where the ad, tracker and popup
       switches sit.

   The switches are the same store the browser toolbar reads, so the two
   surfaces cannot disagree about whether something is on.
   ========================================================================== */

export function ProxyPage() {
  const shield = useShield();
  const proxy = useScramjetState();
  const rules = defaultFilterList();

  const allowedSites = new Set([...shield.settings.allowAds, ...shield.settings.allowPopups]);

  return (
    <>
      <Section
        title="Slow connections (alpha)"
        description="A data saver for proxied pages: the requests that cost the most and matter the least are answered locally instead of being downloaded. Off by default — it changes how pages look, so it is a choice, not a default."
      >
        <Row
          label="Faster on slow connections"
          description="Pictures are answered with an empty pixel, audio and video files, web fonts and beacons are not downloaded at all. Pages, scripts, stylesheets and the data the page fetches stay untouched, and a site you have allowed in Shield is left alone entirely."
          control={
            <Switch
              label="Faster on slow connections"
              checked={shield.settings.lowData}
              onChange={(lowData) => updateShieldSettings({ lowData })}
            />
          }
        />
        <Row label="Pictures" description="Answered with a 1×1 transparent image, so a layout keeps its shape." />
        <Row label="Audio, video and fonts" description="Refused. A page that needs a web font falls back to the system one." />
        <Row label="Beacons and pings" description="Refused. These exist to report on the visit, not to build the page." />
        <Row
          label="Everything else"
          description="Untouched — including video that a site streams through its own player code, which is a fetch, not a media element."
        />
        <p className="cr-row__desc">
          It only applies to pages the proxy is carrying, and it is enforced by the same plugin as Shield,
          so it can be switched off per site with the Shield toolbar button.
        </p>
      </Section>

      <Section
        title="Request path"
        description="Proxied requests leave from the CrystalOS backend, not from this page: the client fetches through the Wisp transport, and the backend dials the real site."
      >
        <Row
          label="Proxy"
          control={
            <Badge
              tone={proxy.status === "ready" ? "success" : proxy.status === "error" ? "danger" : "default"}
              icon={proxy.status === "ready" ? "check" : "info"}
            >
              {proxy.status === "ready"
                ? "Ready"
                : proxy.status === "loading"
                  ? "Starting"
                  : proxy.status === "error"
                    ? "Unavailable"
                    : "Idle"}
            </Badge>
          }
        />
        <Row
          label="Transport"
          description={
            proxy.transport
              ? `Dialling the ${proxy.transport} client over Wisp.`
              : "Not started in this session yet."
          }
        />
        <Row
          label="Blocking"
          description="Shield rides on the proxy: it judges a request inside the proxied frame, before it reaches the transport. With the proxy off there is nothing for it to block."
          control={
            <Badge tone={shield.settings.enabled || shield.settings.lowData ? "accent" : "default"}>
              {shield.settings.enabled && shield.settings.lowData
                ? "Ads + data saver"
                : shield.settings.enabled
                  ? "Ads and trackers"
                  : shield.settings.lowData
                    ? "Data saver"
                    : "Off"}
            </Badge>
          }
        />
      </Section>

      <Section
        title="Shield"
        description="The switches the browser's Shield button shows. They are one setting, not two."
      >
        <Row
          label="Block ads and trackers"
          description="Advertising, ad-exchange and analytics hosts, and the tracking endpoints listed in the rule set below."
          control={
            <Switch
              label="Block ads and trackers"
              checked={shield.settings.enabled}
              onChange={(enabled) => updateShieldSettings({ enabled })}
            />
          }
        />
        <Row
          label="Block popups"
          description="A window that opens by itself is stopped; one a person asked for — a real click, a sign-in popup — still opens. Stopped popups are listed in the toolbar with a way to open them."
          control={
            <Switch
              label="Block popups"
              checked={shield.settings.popups}
              onChange={(popups) => updateShieldSettings({ popups })}
            />
          }
        />
        <Row
          label="Rules"
          description={`${SHIELD_LIST_SOURCE} — ${rules.rules.length} rules${
            rules.unsupported.length > 0 ? `, ${rules.unsupported.length} unsupported` : ""
          }.`}
        />
        <Row
          label="Sites you have allowed"
          description={
            allowedSites.size === 0
              ? "None yet. The toolbar's Shield button has a switch for the site you are on."
              : [...allowedSites].sort().join(", ")
          }
          control={
            allowedSites.size > 0 ? (
              <Button
                size="sm"
                icon="refresh"
                onClick={() => updateShieldSettings({ allowAds: [], allowPopups: [] })}
              >
                Clear
              </Button>
            ) : null
          }
        />
        <Row
          label="Defaults"
          description="Ads and popups blocked, data saver off."
          control={
            <Button
              size="sm"
              icon="refresh"
              onClick={() => updateShieldSettings({ ...DEFAULT_SHIELD_SETTINGS })}
            >
              Restore defaults
            </Button>
          }
        />
      </Section>
    </>
  );
}
