/* ==========================================================================
   CrystalOS Shield — the rule engine

   CrystalOS blocks advertising and tracking requests itself instead of running
   a browser extension. There is no extension host in this runtime (see
   docs/SHIELD.md), and the requests worth blocking are already flowing through
   the shell's Scramjet frames, so the rule language is implemented here and
   enforced in that request path.

   The syntax is the subset of the Adblock Plus / uBlock Origin rule language
   that can be answered from three things: the request URL, the URL of the page
   that asked for it, and the request's type.

     ||host^            the host, and any subdomain of it, any path
     ||host/path        the host, where the path must then follow
     |https://host/…    anchored to the start of the URL
     …suffix|           anchored to the end of the URL
     *                  any run of characters
     ^                  a separator: the end of the URL, or anything that is
                        not a letter, digit, `_`, `-`, `.` or `%`
     @@rule             an exception — matching requests are never blocked
     ! comment          ignored
     [Adblock Plus …]   ignored
     rule$options       see RuleOptions below
     plainhost.example  a bare hostname (or a `0.0.0.0 plainhost.example`
                        hosts-file line) is read as `||plainhost.example^`

   Everything else — cosmetic rules (`##`, `#@#`, `#?#`), scriptlets and any
   option not listed in RuleOptions — is reported in `unsupported` and left
   unenforced. Acting on a rule this engine only half understands would block
   the wrong requests, which is worse than leaving it alone.

   Matching is case-insensitive: patterns are lower-cased when compiled and
   compared against a lower-cased URL. `$match-case` is therefore reported as
   unsupported rather than quietly ignored.
   ========================================================================== */

export type ResourceType =
  | "document"
  | "subdocument"
  | "script"
  | "image"
  | "stylesheet"
  | "font"
  | "media"
  | "xmlhttprequest"
  | "websocket"
  | "ping"
  | "other";

/** Every value `ResourceType` can take; used to validate option names. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  "document",
  "subdocument",
  "script",
  "image",
  "stylesheet",
  "font",
  "media",
  "xmlhttprequest",
  "websocket",
  "ping",
  "other",
];

/** Option names that name a resource type, including the usual short forms. */
const TYPE_OPTIONS: Record<string, ResourceType> = {
  document: "document",
  doc: "document",
  subdocument: "subdocument",
  frame: "subdocument",
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  css: "stylesheet",
  font: "font",
  media: "media",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  websocket: "websocket",
  ping: "ping",
  beacon: "ping",
  other: "other",
  object: "other",
  fetch: "xmlhttprequest",
};

export interface RuleOptions {
  /** `$third-party` — only when the request leaves the page's own site. */
  thirdParty: boolean;
  /** `$first-party` — only when the request stays on the page's own site. */
  firstParty: boolean;
  /** `$script`, `$image`, … — the request must have one of these types. */
  types: ResourceType[];
  /** `$~script`, … — the request must not have any of these types. */
  excludedTypes: ResourceType[];
  /** `$domain=a.example|~b.example` — the page must be, or must not be, there. */
  includeDomains: string[];
  excludeDomains: string[];
}

export interface FilterRule {
  /** The line as it was written, for reporting and tests. */
  raw: string;
  /** `@@` rules allow; everything else blocks. */
  exception: boolean;
  /**
   * Set when the rule is anchored to a host (`||host…`). Looked up by walking
   * the labels of the request's hostname, so no per-request regex scan.
   */
  host: string | null;
  /**
   * Set when a host rule also constrains the path, or when the rule is a
   * pattern rule. Tested against the whole lower-cased URL.
   */
  pattern: RegExp | null;
  options: RuleOptions;
}

export interface UnsupportedRule {
  line: string;
  reason: string;
}

export interface FilterList {
  /** Every rule that was understood, in the order it was written. */
  rules: FilterRule[];
  hostRules: Map<string, FilterRule[]>;
  genericRules: FilterRule[];
  /** Rules that were read but are not enforced, with the reason why. */
  unsupported: UnsupportedRule[];
}

export interface FilterRequest {
  url: string;
  /**
   * The page that made the request. Used for first/third-party and for
   * `$domain=` rules; omitted when the initiator is unknown.
   */
  pageUrl?: string | null;
  type: ResourceType;
}

/* ---- reading rules ------------------------------------------------------- */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns a filter pattern into a regular-expression source. `*` and `^` are the
 * only two pattern characters with meaning; everything else is literal.
 */
export function compilePatternSource(pattern: string): string {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "^") source += "(?:[^a-z0-9_\\-.%]|$)";
    else source += escapeRegExp(character);
  }
  return source;
}

const HOSTNAME_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function isHostname(value: string): boolean {
  return HOSTNAME_SHAPE.test(value);
}

function emptyOptions(): RuleOptions {
  return {
    thirdParty: false,
    firstParty: false,
    types: [],
    excludedTypes: [],
    includeDomains: [],
    excludeDomains: [],
  };
}

interface ParsedOptions {
  options: RuleOptions | null;
  problem: string | null;
}

function parseOptions(text: string): ParsedOptions {
  const options = emptyOptions();
  for (const token of text.split(",")) {
    const raw = token.trim();
    if (!raw) {
      return { options: null, problem: "empty option" };
    }
    const negated = raw.startsWith("~");
    const name = (negated ? raw.slice(1) : raw).toLowerCase();
    const value = name.includes("=") ? name.slice(name.indexOf("=") + 1) : "";
    const key = name.includes("=") ? name.slice(0, name.indexOf("=")) : name;

    if (key === "domain" || key === "from") {
      if (negated || !value) return { options: null, problem: `unsupported option "${raw}"` };
      for (const domain of value.split("|")) {
        const entry = domain.trim().replace(/^\*\./, "");
        if (!entry) continue;
        if (entry.startsWith("~")) options.excludeDomains.push(entry.slice(1));
        else options.includeDomains.push(entry);
      }
      continue;
    }

    if (key === "third-party" || key === "3p") {
      if (negated) return { options: null, problem: `unsupported option "${raw}"` };
      options.thirdParty = true;
      continue;
    }

    if (key === "first-party" || key === "1p") {
      if (negated) return { options: null, problem: `unsupported option "${raw}"` };
      options.firstParty = true;
      continue;
    }

    const type = TYPE_OPTIONS[key];
    if (!type) {
      return { options: null, problem: `unsupported option "${raw}"` };
    }
    const target = negated ? options.excludedTypes : options.types;
    if (!target.includes(type)) target.push(type);
  }

  if (options.thirdParty && options.firstParty) {
    return { options: null, problem: "rule asks for first-party and third-party at once" };
  }

  return { options, problem: null };
}

function hostRuleFrom(body: string, raw: string, exception: boolean, options: RuleOptions): FilterRule | null {
  const slash = body.indexOf("/");
  const separator = body.indexOf("^");
  let hostEnd = body.length;
  if (slash >= 0) hostEnd = Math.min(hostEnd, slash);
  if (separator >= 0) hostEnd = Math.min(hostEnd, separator);

  const host = body.slice(0, hostEnd).toLowerCase();
  const rest = body.slice(hostEnd).toLowerCase();
  if (!isHostname(host)) return null;

  if (rest === "" || rest === "^") {
    return { raw, exception, host, pattern: null, options };
  }

  /* `||host^/path` or `||host/path`: the host must be followed by exactly what
     the rule wrote, on a URL. The optional scheme and subdomain prefix mirror
     what `||` promises. */
  const source =
    "^(?:[a-z][a-z0-9+.\\-]*:)?//(?:[^/?#]*\\.)?" +
    escapeRegExp(host) +
    compilePatternSource(rest);
  return { raw, exception, host, pattern: new RegExp(source), options };
}

type ParseLineResult =
  | { kind: "rule"; rule: FilterRule }
  | { kind: "unsupported"; unsupported: UnsupportedRule }
  | { kind: "ignore" };

export function parseFilterLine(rawLine: string): ParseLineResult {
  const line = rawLine.trim();
  if (!line) return { kind: "ignore" };
  if (line.startsWith("!") || line.startsWith("# ") || line.startsWith("#!")) return { kind: "ignore" };
  if (line.startsWith("[")) return { kind: "ignore" };

  if (line.includes("##") || line.includes("#@#") || line.includes("#?#")) {
    return { kind: "unsupported", unsupported: { line, reason: "cosmetic filtering is not implemented" } };
  }

  let body = line;
  const exception = body.startsWith("@@");
  if (exception) body = body.slice(2);

  let options = emptyOptions();
  const dollar = body.indexOf("$");
  if (dollar >= 0) {
    const parsed = parseOptions(body.slice(dollar + 1));
    if (!parsed.options) {
      return { kind: "unsupported", unsupported: { line, reason: parsed.problem ?? "unsupported options" } };
    }
    options = parsed.options;
    body = body.slice(0, dollar);
  }

  if (!body) {
    return { kind: "unsupported", unsupported: { line, reason: "rule has options but no pattern" } };
  }

  if (body.startsWith("||")) {
    const rule = hostRuleFrom(body.slice(2), line, exception, options);
    if (rule) return { kind: "rule", rule };
    // `||` with wildcards in the host part: fall through to a pattern rule.
  }

  let pattern = body;
  let startAnchor = false;
  if (pattern.startsWith("|")) {
    startAnchor = true;
    pattern = pattern.slice(1);
  }
  let endAnchor = false;
  if (pattern.endsWith("|")) {
    endAnchor = true;
    pattern = pattern.slice(0, -1);
  }

  /* A bare hostname is a host rule: that is how a hand-written list reads, and
     it is what a hosts-file line (`0.0.0.0 example.com`) carries. */
  if (!startAnchor && !endAnchor) {
    const candidate = pattern
      .replace(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+/, "")
      .replace(/\s+.*$/, "");
    if (candidate && isHostname(candidate)) {
      return {
        kind: "rule",
        rule: { raw: line, exception, host: candidate.toLowerCase(), pattern: null, options },
      };
    }
  }

  if (!pattern) {
    return { kind: "unsupported", unsupported: { line, reason: "rule has no pattern" } };
  }

  const source =
    (startAnchor ? "^" : "") + compilePatternSource(pattern.toLowerCase()) + (endAnchor ? "$" : "");
  return {
    kind: "rule",
    rule: { raw: line, exception, host: null, pattern: new RegExp(source), options },
  };
}

/** Groups already-parsed rules into the maps the matcher walks. */
export function buildFilterList(rules: FilterRule[], unsupported: UnsupportedRule[] = []): FilterList {
  const hostRules = new Map<string, FilterRule[]>();
  const genericRules: FilterRule[] = [];
  for (const rule of rules) {
    if (rule.host) {
      const bucket = hostRules.get(rule.host);
      if (bucket) bucket.push(rule);
      else hostRules.set(rule.host, [rule]);
    } else {
      genericRules.push(rule);
    }
  }
  return { rules, hostRules, genericRules, unsupported };
}

export function parseFilterList(text: string): FilterList {
  const rules: FilterRule[] = [];
  const unsupported: UnsupportedRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseFilterLine(line);
    if (parsed.kind === "rule") rules.push(parsed.rule);
    else if (parsed.kind === "unsupported") unsupported.push(parsed.unsupported);
  }
  return buildFilterList(rules, unsupported);
}

/* ---- URLs and sites ------------------------------------------------------ */

export function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * The site a hostname belongs to, used for first/third-party decisions.
 *
 * This is deliberately the last two labels — `www.example.com` is
 * `example.com` — plus a short list of the two-label public suffixes that are
 * common enough that getting them wrong would misclassify real traffic
 * (`co.uk` and friends). It is an approximation of the public suffix list, not
 * a copy of it: a full list is large, and the only thing it decides here is
 * whether a `$third-party` rule may fire. docs/SHIELD.md says the same.
 */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.in", "net.in", "org.in", "gov.in", "ac.in",
  "co.za", "org.za", "net.za", "gov.za",
  "com.mx", "com.tr", "com.tw", "com.hk", "com.sg", "com.ar", "com.co",
  "co.kr", "or.kr", "go.kr",
]);

export function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** True when both hosts belong to the same site, or one is under the other. */
export function sameSite(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return true;
  if (left.endsWith("." + right) || right.endsWith("." + left)) return true;
  return siteOf(left) === siteOf(right);
}

/** Maps a fetch `RequestDestination` (or a Scramjet destination) to a rule type. */
export function classifyDestination(destination: string): ResourceType {
  switch (destination) {
    case "document":
      return "document";
    case "iframe":
    case "frame":
      return "subdocument";
    case "script":
    case "worker":
    case "sharedworker":
    case "serviceworker":
      return "script";
    case "image":
      return "image";
    case "style":
    case "stylesheet":
      return "stylesheet";
    case "font":
      return "font";
    case "audio":
    case "video":
    case "track":
    case "media":
      return "media";
    case "xslt":
    case "manifest":
    case "report":
    case "embed":
    case "object":
    case "empty":
      return "other";
    case "xhr":
    case "fetch":
      return "xmlhttprequest";
    case "websocket":
      return "websocket";
    case "beacon":
    case "ping":
    case "csp_report":
      return "ping";
    default:
      return "other";
  }
}

/* ---- matching ------------------------------------------------------------ */

function domainAllowed(domains: string[], pageHost: string | null): boolean {
  if (!pageHost) return false;
  return domains.some((domain) => pageHost === domain || pageHost.endsWith("." + domain));
}

function domainExcluded(domains: string[], pageHost: string | null): boolean {
  if (!pageHost) return false;
  return domains.some((domain) => pageHost === domain || pageHost.endsWith("." + domain));
}

function optionsAllow(rule: FilterRule, request: FilterRequest, pageHost: string | null): boolean {
  const { options } = rule;
  if (options.types.length > 0 && !options.types.includes(request.type)) return false;
  if (options.excludedTypes.includes(request.type)) return false;

  if (options.thirdParty || options.firstParty) {
    if (!pageHost) return false;
    const thirdParty = !sameSite(pageHost, hostnameOf(request.url) ?? "");
    if (options.thirdParty && !thirdParty) return false;
    if (options.firstParty && thirdParty) return false;
  }

  if (options.includeDomains.length > 0 && !domainAllowed(options.includeDomains, pageHost)) return false;
  if (options.excludeDomains.length > 0 && domainExcluded(options.excludeDomains, pageHost)) return false;
  return true;
}

export interface MatchResult {
  blocked: boolean;
  /** The blocking rule that decided it, when one did. */
  rule: FilterRule | null;
  /** The exception that spared the request, when one did. */
  exception: FilterRule | null;
}

const ALLOWED: MatchResult = { blocked: false, rule: null, exception: null };

/**
 * Walks a hostname's label suffixes, so `ads.example.com` finds a rule written
 * for `example.com` without scanning every rule for every request.
 */
function labelSuffixes(host: string): string[] {
  const labels = host.split(".");
  const suffixes: string[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    suffixes.push(labels.slice(index).join("."));
  }
  return suffixes;
}

export function matchRequest(list: FilterList, request: FilterRequest): MatchResult {
  const host = hostnameOf(request.url);
  if (!host) return ALLOWED;
  const url = request.url.toLowerCase();
  const pageHost = request.pageUrl ? hostnameOf(request.pageUrl) : null;

  const hostMatches: FilterRule[] = [];
  for (const suffix of labelSuffixes(host)) {
    const bucket = list.hostRules.get(suffix);
    if (!bucket) continue;
    for (const rule of bucket) {
      if (rule.pattern && !rule.pattern.test(url)) continue;
      if (!optionsAllow(rule, request, pageHost)) continue;
      hostMatches.push(rule);
    }
  }

  const patternMatches: FilterRule[] = [];
  for (const rule of list.genericRules) {
    if (!rule.pattern?.test(url)) continue;
    if (!optionsAllow(rule, request, pageHost)) continue;
    patternMatches.push(rule);
  }

  const matches = [...hostMatches, ...patternMatches];
  if (matches.length === 0) return ALLOWED;

  const exception = matches.find((rule) => rule.exception);
  if (exception) return { blocked: false, rule: null, exception };

  /* Rule order is the list's order for pattern matches, but a host match was
     found by lookup rather than by scanning, so `list.rules` is the only
     ordering that means the same thing to everyone. */
  const block = list.rules.find((rule) => matches.includes(rule) && !rule.exception) ?? null;
  if (!block) return ALLOWED;
  return { blocked: true, rule: block, exception: null };
}
