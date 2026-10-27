/*
 * CrystalOS — Crystal AI markdown parser tests
 *
 * The parser's whole reason to exist is safety plus predictability: an AI
 * answer can quote a web page full of <script> tags, and none of it may ever
 * become markup. These tests pin down that raw HTML stays text, unsafe link
 * schemes stay literal, and the structures AI answers actually contain —
 * fences, headings, lists, quotes, inline code — parse the way the renderer
 * expects.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveWithExtensions(base) {
  for (const suffix of ["", ".ts", ".tsx", ".mjs", ".js"]) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolveWithExtensions(resolvePath(SRC_ROOT, specifier.slice(2)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      const target = resolveWithExtensions(base);
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { parseMarkdown, parseInline, inlineText } = await import("./markdown.ts");

/** Depth-first walk of every inline node in a block list. */
function everyInline(blocks) {
  const out = [];
  const visit = (inlines) => {
    for (const node of inlines ?? []) {
      out.push(node);
      if (node.content) visit(node.content);
      if (node.label) visit(node.label);
    }
  };
  for (const block of blocks) {
    if (block.content && Array.isArray(block.content)) visit(block.content);
    if (block.items) for (const item of block.items) visit(item);
  }
  return out;
}

describe("markdown safety", () => {
  test("raw HTML renders as text, never as markup", () => {
    const blocks = parseMarkdown('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
    for (const block of blocks) {
      assert.notEqual(block.kind, "html");
    }
    const text = blocks
      .map((b) => (b.content ? inlineText(b.content) : ""))
      .join("");
    assert.match(text, /<script>/);
  });

  test("javascript: links stay literal text, not links", () => {
    const inlines = parseInline("[click me](javascript:alert(1))");
    assert.equal(inlines.some((n) => n.kind === "link"), false);
    assert.match(inlineText(inlines), /javascript:alert\(1\)/);
  });

  test("http and https links become links", () => {
    const inlines = parseInline("[docs](https://docs.puter.com/AI/chat/)");
    const link = inlines.find((n) => n.kind === "link");
    assert.ok(link);
    assert.equal(link.href, "https://docs.puter.com/AI/chat/");
    assert.equal(inlineText(link.label), "docs");
  });
});

describe("markdown structure", () => {
  test("fenced code blocks capture language and body verbatim", () => {
    const blocks = parseMarkdown("```js\nconst a = 1;\n// **not bold**\n```");
    const code = blocks.find((b) => b.kind === "code");
    assert.ok(code);
    assert.equal(code.lang, "js");
    assert.equal(code.code, "const a = 1;\n// **not bold**");
  });

  test("an unterminated fence still ends, without hanging", () => {
    const blocks = parseMarkdown("```\nnever closed");
    const code = blocks.find((b) => b.kind === "code");
    assert.ok(code);
    assert.equal(code.code, "never closed");
  });

  test("headings by level", () => {
    const blocks = parseMarkdown("# One\n\n### Three");
    assert.equal(blocks[0].kind, "heading");
    assert.equal(blocks[0].level, 1);
    assert.equal(blocks[1].level, 3);
    assert.equal(inlineText(blocks[0].content), "One");
  });

  test("unordered and ordered lists", () => {
    const blocks = parseMarkdown("- one\n- two\n\n1. first\n2. second");
    const ul = blocks.find((b) => b.kind === "list" && !b.ordered);
    const ol = blocks.find((b) => b.kind === "list" && b.ordered);
    assert.equal(ul.items.length, 2);
    assert.equal(ol.items.length, 2);
    assert.equal(inlineText(ul.items[0]), "one");
    assert.equal(inlineText(ol.items[1]), "second");
  });

  test("blockquotes strip the marker", () => {
    const blocks = parseMarkdown("> said the model\n> across two lines");
    assert.equal(blocks[0].kind, "quote");
    assert.equal(inlineText(blocks[0].content), "said the model across two lines");
  });

  test("inline code wins over bold markers inside it", () => {
    const inlines = parseInline("`**literal**` and **real**");
    assert.equal(inlines[0].kind, "code");
    assert.equal(inlines[0].code, "**literal**");
    assert.equal(inlines[2].kind, "strong");
  });

  test("paragraphs merge continuation lines", () => {
    const blocks = parseMarkdown("line one\nline two\n\nnext para");
    assert.equal(blocks.length, 2);
    assert.equal(inlineText(blocks[0].content), "line one line two");
  });

  test("hr is recognized", () => {
    const blocks = parseMarkdown("---");
    assert.equal(blocks[0].kind, "hr");
  });

  test("empty input parses to nothing", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown("\n\n  \n"), []);
  });

  test("strikes and emphasis round-trip their text", () => {
    const inlines = parseInline("~~gone~~ and *here*");
    assert.equal(inlines[0].kind, "del");
    assert.equal(inlines[2].kind, "em");
    assert.equal(inlineText(inlines), "gone and here");
  });

  test("every node the parser emits is a known kind", () => {
    const sample = [
      "# t", "", "**b** `c` [l](https://x.test) ~~d~~ *e*", "", "```", "x", "```",
      "", "> q", "", "- i", "", "---",
    ].join("\n");
    const blocks = parseMarkdown(sample);
    const blockKinds = new Set(["heading", "paragraph", "code", "quote", "list", "hr"]);
    const inlineKinds = new Set(["text", "code", "strong", "em", "del", "link"]);
    for (const block of blocks) assert.ok(blockKinds.has(block.kind), block.kind);
    for (const node of everyInline(blocks)) assert.ok(inlineKinds.has(node.kind), node.kind);
  });
});
