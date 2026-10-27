import { parseFilterList, type FilterList } from "./filter";

/* ==========================================================================
   CrystalOS Shield — the list that ships with the OS

   Provenance: this list was written for CrystalOS. It is not a copy of
   EasyList, EasyPrivacy, uBlock's own lists or any other third-party filter
   list — those are published under licences (GPL-3.0 / CC BY-SA) that do not
   belong in this repository, which is the same reason the vendored browser
   extensions were removed in v1.3.0 (see docs/HOXX-VPN-FINDINGS.md).

   What is here is the well-known advertising, tracking, telemetry and
   pop-under infrastructure that shows up in every public list, written as
   hostnames so the list stays readable and reviewable. It is deliberately
   small: a rule that is wrong breaks somebody's page, and every host below was
   checked to be an ad or analytics service rather than a site's own CDN.

   Without a full public list this blocks far less than uBlock Origin with
   EasyList. That is stated plainly in docs/SHIELD.md rather than papered over.
   The engine itself accepts a larger list, but the app loads this one: there is
   no custom-rule editor yet, so nothing here pretends a person can add to it.
   ========================================================================== */

export const SHIELD_LIST_VERSION = "1";

/** Human-readable source note, shown in the Shield panel. */
export const SHIELD_LIST_SOURCE = "Written for CrystalOS (v" + SHIELD_LIST_VERSION + ")";

export const DEFAULT_FILTER_RULES = `
! ---------------------------------------------------------------------------
! Advertising, ad exchange and ad-serving infrastructure
! ---------------------------------------------------------------------------
doubleclick.net
googleadservices.com
googlesyndication.com
googleads.g.doubleclick.net
adservice.google.com
adnxs.com
advertising.com
adsrvr.org
adform.net
amazon-adsystem.com
bidswitch.net
casalemedia.com
criteo.com
criteo.net
districtm.io
indexexchange.com
inmobi.com
lijit.com
media.net
mgid.com
mookie1.com
openx.net
pubmatic.com
revcontent.com
rubiconproject.com
sharethrough.com
smaato.net
smartadserver.com
sovrn.com
spotxchange.com
taboola.com
teads.tv
themoneytizer.com
33across.com
3lift.com
yieldmo.com
zergnet.com

! Pop-under and interstitial networks. These are the request-time source of
! most "a popup opened when I clicked anywhere" reports.
adcash.com
adsterra.com
clickadu.com
exoclick.com
hilltopads.net
infolinks.com
juicyads.com
onclickads.net
popads.net
popcash.net
propellerads.com
trafficjunky.net
trafficstars.com

! ---------------------------------------------------------------------------
! Analytics, measurement and cross-site tracking
! ---------------------------------------------------------------------------
google-analytics.com
googletagmanager.com
analytics.google.com
2o7.net
adsafeprotected.com
agkn.com
bluekai.com
branch.io
chartbeat.com
cloudflareinsights.com
crwdcntrl.net
demdex.net
doubleverify.com
exelator.com
hotjar.com
imrworldwide.com
krxd.net
mathtag.com
mixpanel.com
moatads.com
mookie1.com
newrelic.com
omtrdc.net
optimizely.com
parsely.com
quantserve.com
quantcount.com
rlcdn.com
scorecardresearch.com
segment.io
segment.com
statcounter.com
tapad.com
tealiumiq.com
tns-counter.ru
turn.com
yandex-metrica.com
zeotap.com

! ---------------------------------------------------------------------------
! Precise rules
!
! facebook.com also hosts the login widgets and the Graph API, so it is never
! blocked as a host. The pixel endpoint is, and only when a third-party page
! loads it.
! ---------------------------------------------------------------------------
||facebook.com/tr^$third-party

! The Google Analytics collect endpoints, for the case where the host rule above
! is unwanted and a rule with a narrower shape is preferred. Kept commented so
! the shipped list has one behaviour, not two.
! ||google-analytics.com/collect^
! ||google-analytics.com/g/collect^
`;

let compiled: FilterList | null = null;

/** The shipped list, compiled once per page load. */
export function defaultFilterList(): FilterList {
  if (!compiled) compiled = parseFilterList(DEFAULT_FILTER_RULES);
  return compiled;
}
