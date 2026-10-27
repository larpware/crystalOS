/*
 * CrystalOS — Shield rule engine tests
 *
 * The engine reads a subset of the Adblock Plus / uBlock Origin rule language.
 * These tests pin down what each part of that subset means, and — just as
 * importantly — that a rule the engine only half understands is reported as
 * unsupported instead of being applied approximately. A rule applied wrongly
 * blocks the wrong request, which is worse than a rule not applied at all.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveWithExtensions(base) {
  if (existsSync(base)) return base;
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = resolvePath(SRC_ROOT, specifier.slice(2));
    } else if (
      !/\.[cm]?[jt]sx?$|\.json$/.test(specifier) &&
      specifier.startsWith(".") &&
      context.parentURL
    ) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const found = base === null ? null : resolveWithExtensions(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const {
  buildFilterList,
  classifyDestination,
  hostnameOf,
  matchRequest,
  parseFilterLine,
  parseFilterList,
  sameSite,
  siteOf,
} = await import("@/services/shield/filter");
const { DEFAULT_FILTER_RULES, defaultFilterList } = await import("@/services/shield/list");

/** One rule, compiled the way the matcher expects. */
function listOf(...lines) {
  return parseFilterList(lines.join("\n"));
}

function match(lines, request) {
  return matchRequest(listOf(...lines), { pageUrl: null, type: "xmlhttprequest", ...request });
}

describe("parseFilterLine", () => {
  test("a host rule is looked up by host, with no pattern", () => {
    const parsed = parseFilterLine("||ads.example.com^");
    assert.equal(parsed.kind, "rule");
    assert.equal(parsed.rule.host, "ads.example.com");
    assert.equal(parsed.rule.pattern, null);
    assert.equal(parsed.rule.exception, false);
  });

  test("a host rule with a path keeps the path constraint", () => {
    const parsed = parseFilterLine("||example.com/track");
    assert.equal(parsed.kind, "rule");
    assert.equal(parsed.rule.host, "example.com");
    assert.ok(parsed.rule.pattern instanceof RegExp);
  });

  test("a bare hostname is a host rule", () => {
    const parsed = parseFilterLine("ads.example.com");
    assert.equal(parsed.kind, "rule");
    assert.equal(parsed.rule.host, "ads.example.com");
  });

  test("a hosts-file line is read as the same thing", () => {
    for (const line of ["0.0.0.0 ads.example.com", "127.0.0.1 ads.example.com"]) {
      const parsed = parseFilterLine(line);
      assert.equal(parsed.kind, "rule", line);
      assert.equal(parsed.rule.host, "ads.example.com", line);
    }
  });

  test("start and end anchors become a pattern rule", () => {
    const start = parseFilterLine("|https://example.com/start");
    assert.equal(start.kind, "rule");
    assert.equal(start.rule.host, null);
    assert.equal(start.rule.pattern.source.startsWith("^"), true);

    const end = parseFilterLine("swf|");
    assert.equal(end.kind, "rule");
    assert.equal(end.rule.pattern.source.endsWith("$"), true);
  });

  test("an exception is marked, not a separate kind of rule", () => {
    const parsed = parseFilterLine("@@||example.com/ads.js");
    assert.equal(parsed.kind, "rule");
    assert.equal(parsed.rule.exception, true);
  });

  test("comments and list headers are ignored", () => {
    for (const line of ["! a comment", "[Adblock Plus 2.0]", "# a hosts comment", ""]) {
      assert.equal(parseFilterLine(line).kind, "ignore", line);
    }
  });

  test("cosmetic rules are reported as unsupported, never half-applied", () => {
    for (const line of ["example.com##.ad", "example.com#@#.ad", "example.com#?#.ad"]) {
      const parsed = parseFilterLine(line);
      assert.equal(parsed.kind, "unsupported", line);
      assert.match(parsed.unsupported.reason, /cosmetic/);
    }
  });

  test("an option the engine does not implement makes the whole rule unsupported", () => {
    const parsed = parseFilterLine("||example.com^$popup");
    assert.equal(parsed.kind, "unsupported");
    assert.match(parsed.unsupported.reason, /popup/);
  });

  test("$match-case is refused rather than silently ignored", () => {
    const parsed = parseFilterLine("||example.com^$match-case");
    assert.equal(parsed.kind, "unsupported");
  });

  test("options it does implement are carried onto the rule", () => {
    const parsed = parseFilterLine("||ads.example.com^$third-party,image,~script,domain=a.example|~b.example");
    assert.equal(parsed.kind, "rule");
    assert.deepEqual(parsed.rule.options.thirdParty, true);
    assert.deepEqual(parsed.rule.options.types, ["image"]);
    assert.deepEqual(parsed.rule.options.excludedTypes, ["script"]);
    assert.deepEqual(parsed.rule.options.includeDomains, ["a.example"]);
    assert.deepEqual(parsed.rule.options.excludeDomains, ["b.example"]);
  });

  test("first-party and third-party at once is a contradiction, not a rule", () => {
    assert.equal(parseFilterLine("||example.com^$1p,3p").kind, "unsupported");
  });

  test("a rule with options but no pattern is refused", () => {
    assert.equal(parseFilterLine("$third-party").kind, "unsupported");
  });
});

describe("matchRequest — host rules", () => {
  test("a host rule covers the host and its subdomains", () => {
    assert.equal(match(["||ads.example.com^"], { url: "https://ads.example.com/a" }).blocked, true);
    assert.equal(match(["||ads.example.com^"], { url: "https://x.ads.example.com/a" }).blocked, true);
    assert.equal(match(["||ads.example.com^"], { url: "https://example.com/a" }).blocked, false);
  });

  test("a host rule does not match a host that merely ends with the same text", () => {
    for (const url of [
      "https://notads.example.com.evil.test/a",
      "https://ads.example.com.evil.test/a",
      "https://myexample.com/a",
    ]) {
      assert.equal(match(["||example.com^"], { url }).blocked, false, url);
    }
  });

  test("a path in the rule must follow the host", () => {
    const lines = ["||example.com/track"];
    assert.equal(match(lines, { url: "https://example.com/track?id=1" }).blocked, true);
    assert.equal(match(lines, { url: "https://sub.example.com/track" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/tracking" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/other" }).blocked, false);
    assert.equal(match(lines, { url: "https://example.com/x/track" }).blocked, false);
  });

  test("matching is case-insensitive", () => {
    assert.equal(match(["||ADS.EXAMPLE.COM^"], { url: "https://Ads.Example.Com/A" }).blocked, true);
    assert.equal(match(["||ads.example.com^"], { url: "HTTPS://ADS.EXAMPLE.COM/A" }).blocked, true);
  });

  test("the rule that decided it is reported", () => {
    const result = match(["||ads.example.com^"], { url: "https://ads.example.com/a" });
    assert.equal(result.rule.raw, "||ads.example.com^");
    assert.equal(result.exception, null);
  });
});

describe("matchRequest — exceptions and options", () => {
  test("an exception spares a request a blocking rule would have caught", () => {
    const lines = ["||example.com^", "@@||example.com/allowed.js"];
    const blocked = match(lines, { url: "https://example.com/ads.js" });
    assert.equal(blocked.blocked, true);
    const spared = match(lines, { url: "https://example.com/allowed.js" });
    assert.equal(spared.blocked, false);
    assert.equal(spared.exception.raw, "@@||example.com/allowed.js");
  });

  test("$third-party only fires when the page is a different site", () => {
    const lines = ["||tracker.example^$third-party"];
    const thirdParty = match(lines, {
      url: "https://tracker.example/pixel",
      pageUrl: "https://news.example/article",
    });
    assert.equal(thirdParty.blocked, true);

    const firstParty = match(lines, {
      url: "https://tracker.example/pixel",
      pageUrl: "https://www.tracker.example/home",
    });
    assert.equal(firstParty.blocked, false);
  });

  test("$third-party stays quiet when the initiating page is unknown", () => {
    const lines = ["||tracker.example^$third-party"];
    assert.equal(match(lines, { url: "https://tracker.example/pixel", pageUrl: null }).blocked, false);
  });

  test("$first-party is the mirror", () => {
    const lines = ["||example.com^$first-party"];
    assert.equal(
      match(lines, { url: "https://example.com/a", pageUrl: "https://example.com/b" }).blocked,
      true,
    );
    assert.equal(
      match(lines, { url: "https://example.com/a", pageUrl: "https://other.example/b" }).blocked,
      false,
    );
  });

  test("a resource type narrows the rule", () => {
    const lines = ["||example.com^$image"];
    assert.equal(match(lines, { url: "https://example.com/a.png", type: "image" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/a.js", type: "script" }).blocked, false);
  });

  test("a negated type excludes it", () => {
    const lines = ["||example.com^$~script"];
    assert.equal(match(lines, { url: "https://example.com/a.js", type: "script" }).blocked, false);
    assert.equal(match(lines, { url: "https://example.com/a.png", type: "image" }).blocked, true);
  });

  test("$domain= limits the rule to pages on that domain", () => {
    const lines = ["||ads.example^$domain=news.example"];
    assert.equal(
      match(lines, { url: "https://ads.example/x", pageUrl: "https://news.example/a" }).blocked,
      true,
    );
    assert.equal(
      match(lines, { url: "https://ads.example/x", pageUrl: "https://blog.example/a" }).blocked,
      false,
    );
    // A subdomain of the listed domain counts as being on it.
    assert.equal(
      match(lines, { url: "https://ads.example/x", pageUrl: "https://m.news.example/a" }).blocked,
      true,
    );
  });

  test("$domain=~ excludes a page", () => {
    const lines = ["||ads.example^$domain=~news.example"];
    assert.equal(
      match(lines, { url: "https://ads.example/x", pageUrl: "https://news.example/a" }).blocked,
      false,
    );
    assert.equal(
      match(lines, { url: "https://ads.example/x", pageUrl: "https://blog.example/a" }).blocked,
      true,
    );
  });
});

describe("matchRequest — pattern and anchor rules", () => {
  test("a start anchor means the URL must begin there", () => {
    const lines = ["|https://example.com/ad"];
    assert.equal(match(lines, { url: "https://example.com/ad.js" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/x/ad.js" }).blocked, false);
  });

  test("an end anchor means the URL must end there", () => {
    const lines = ["/ads.js|"];
    assert.equal(match(lines, { url: "https://example.com/ads.js" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/ads.js?1" }).blocked, false);
  });

  test("* matches any run of characters", () => {
    const lines = ["/ad*banner"];
    assert.equal(match(lines, { url: "https://example.com/ad-banner" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/ad-delay/banner" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com/banner" }).blocked, false);
  });

  test("^ is a separator, and also the end of the URL", () => {
    const lines = ["||example.com^"];
    assert.equal(match(lines, { url: "https://example.com/" }).blocked, true);
    assert.equal(match(lines, { url: "https://example.com" }).blocked, true);
  });

  test("a path-only rule matches any host", () => {
    const lines = ["/pagead/"];
    assert.equal(match(lines, { url: "https://any.test/pagead/x.js" }).blocked, true);
    assert.equal(match(lines, { url: "https://any.test/content" }).blocked, false);
  });
});

describe("URL helpers", () => {
  test("hostnameOf reads the host, and says nothing about nonsense", () => {
    assert.equal(hostnameOf("https://Sub.Example.com/a"), "sub.example.com");
    assert.equal(hostnameOf("not a url"), null);
    assert.equal(hostnameOf(""), null);
  });

  test("siteOf is the registrable-ish domain, with a small suffix list", () => {
    assert.equal(siteOf("www.example.com"), "example.com");
    assert.equal(siteOf("a.b.example.com"), "example.com");
    assert.equal(siteOf("example.com"), "example.com");
    assert.equal(siteOf("shop.example.co.uk"), "example.co.uk");
    assert.equal(siteOf("localhost"), "localhost");
  });

  test("sameSite groups subdomains but not different sites", () => {
    assert.equal(sameSite("www.example.com", "example.com"), true);
    assert.equal(sameSite("a.example.com", "b.example.com"), true);
    assert.equal(sameSite("example.com", "other.example"), false);
  });

  test("destinations map onto the rule types", () => {
    assert.equal(classifyDestination("document"), "document");
    assert.equal(classifyDestination("iframe"), "subdocument");
    assert.equal(classifyDestination("script"), "script");
    assert.equal(classifyDestination("worker"), "script");
    assert.equal(classifyDestination("image"), "image");
    assert.equal(classifyDestination("style"), "stylesheet");
    assert.equal(classifyDestination("font"), "font");
    assert.equal(classifyDestination("video"), "media");
    assert.equal(classifyDestination("xhr"), "xmlhttprequest");
    assert.equal(classifyDestination("fetch"), "xmlhttprequest");
    assert.equal(classifyDestination("websocket"), "websocket");
    assert.equal(classifyDestination("beacon"), "ping");
    assert.equal(classifyDestination("something-new"), "other");
  });
});

describe("parseFilterList", () => {
  test("rules and unsupported lines are separated, order preserved", () => {
    const list = parseFilterList(
      ["! header", "||a.example^", "b.example##.ad", "||c.example^"].join("\n"),
    );
    assert.deepEqual(
      list.rules.map((rule) => rule.raw),
      ["||a.example^", "||c.example^"],
    );
    assert.equal(list.unsupported.length, 1);
    assert.equal(list.unsupported[0].line, "b.example##.ad");
  });

  test("host rules are indexed so matching is a lookup, not a scan", () => {
    const list = parseFilterList(["||a.example^", "||b.example^", "/shared/"].join("\n"));
    assert.equal(list.hostRules.get("a.example").length, 1);
    assert.equal(list.hostRules.get("b.example").length, 1);
    assert.equal(list.genericRules.length, 1);
  });

  test("buildFilterList accepts rules parsed one at a time", () => {
    const rules = ["||a.example^", "||b.example^/x"].map((line) => parseFilterLine(line).rule);
    const list = buildFilterList(rules);
    assert.equal(list.rules.length, 2);
  });
});

describe("the shipped list", () => {
  test("every line in it is understood — nothing silent", () => {
    const list = defaultFilterList();
    assert.deepEqual(list.unsupported, []);
    assert.ok(list.rules.length > 40);
  });

  test("it blocks advertising and tracking hosts", () => {
    const list = defaultFilterList();
    for (const url of [
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
      "https://www.google-analytics.com/g/collect?v=2",
      "https://cdn.doubleclick.net/ddm/ad",
      "https://static.criteo.net/js/ld/publishertag.js",
      "https://a.taboola.com/libtrc/x",
      "https://ads.pubmatic.com/AdServer/js/x.js",
    ]) {
      assert.equal(matchRequest(list, { url, pageUrl: "https://news.example/", type: "script" }).blocked, true, url);
    }
  });

  test("it leaves ordinary destinations and first-party traffic alone", () => {
    const list = defaultFilterList();
    for (const url of [
      "https://news.example/article",
      "https://cdn.jsdelivr.net/npm/lodash/lodash.min.js",
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      "https://www.facebook.com/tr?id=1&ev=PageView", // first-party: the page is Facebook
    ]) {
      const pageUrl = url.includes("facebook.com") ? "https://www.facebook.com/" : "https://news.example/";
      assert.equal(matchRequest(list, { url, pageUrl, type: "script" }).blocked, false, url);
    }
  });

  test("the one precise rule only fires for third-party pages", () => {
    const list = defaultFilterList();
    assert.equal(
      matchRequest(list, {
        url: "https://www.facebook.com/tr?id=1",
        pageUrl: "https://shop.example/",
        type: "image",
      }).blocked,
      true,
    );
    assert.equal(
      matchRequest(list, {
        url: "https://www.facebook.com/tr?id=1",
        pageUrl: "https://www.facebook.com/",
        type: "image",
      }).blocked,
      false,
    );
  });

  test("the list text has no rule the engine would refuse", () => {
    for (const line of DEFAULT_FILTER_RULES.split(/\r?\n/)) {
      const parsed = parseFilterLine(line);
      assert.notEqual(parsed.kind, "unsupported", line);
    }
  });
});
