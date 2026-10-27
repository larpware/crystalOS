/* ==========================================================================
   CrystalOS Shield

   The rule engine (`./filter`), the list that ships with the OS (`./list`),
   the decisions (`./decision`), what is remembered (`./state`) and the
   Scramjet plugin that enforces it (`./plugin`).

   `docs/SHIELD.md` describes what it does, what it deliberately does not do,
   and where each part came from.
   ========================================================================== */

export type { FilterList, FilterRule, ResourceType, UnsupportedRule } from "./filter";
export { classifyDestination, hostnameOf, matchRequest, parseFilterList, siteOf } from "./filter";

export type { PopupOutcome, RequestOutcome } from "./decision";
export {
  LOW_DATA_BLOCKED_TYPES,
  LOW_DATA_PLACEHOLDER_TYPES,
  POPUP_GESTURE_WINDOW_MS,
  decidePopup,
  decideRequest,
} from "./decision";

export { DEFAULT_FILTER_RULES, SHIELD_LIST_SOURCE, SHIELD_LIST_VERSION, defaultFilterList } from "./list";

export type { PopupRecord, ShieldSettings, ShieldState } from "./state";
export {
  DEFAULT_SHIELD_SETTINGS,
  blockedFor,
  clearPopups,
  dismissPopup,
  getShieldState,
  isPopupSiteAllowed,
  isSiteAllowed,
  lastBlockedFor,
  noteBlocked,
  notePopup,
  popupsFor,
  resetBlocked,
  setPopupSiteAllowed,
  setSiteAllowed,
  siteKey,
  subscribeShield,
  updateShieldSettings,
} from "./state";

export { createShieldPlugin, shieldAvailable, siteOfUrl } from "./plugin";
