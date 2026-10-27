/* ==========================================================================
   Crystal AI — markdown

   A small, deliberately conservative markdown renderer. It exists because AI
   answers are full of code blocks, lists and headings, and CrystalOS ships no
   markdown dependency that would have to be kept current.

   Safety model: nothing here ever produces HTML strings. The parser returns a
   tree of typed nodes; the React renderer maps them to elements. Raw HTML in
   the source is text, always — an AI answer can quote a web page, and that
   must never become markup in the desktop.

   The parser is pure and lives apart from React so `markdown.test.mjs` can
   pin down its behaviour without a browser.
   ========================================================================== */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string }
  | { kind: "strong"; content: Inline[] }
  | { kind: "em"; content: Inline[] }
  | { kind: "del"; content: Inline[] }
  | { kind: "link"; href: string; label: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "hr" };

/** Only real web links are links. `javascript:` etc. stay plain text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^#/.test(trimmed)) return trimmed;
  return null;
}

/** Inline pass: code spans first, then bold, then italic, then links. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;

  const flushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  };

  while (rest.length > 0) {
    // Code span: `...`
    const codeMatch = rest.match(/^`([^`]+)`/);
    if (codeMatch) {
      out.push({ kind: "code", code: codeMatch[1] });
      rest = rest.slice(codeMatch[0].length);
      continue;
    }
    // Strong: **...** or __...__
    const strongMatch = rest.match(/^(\*\*|__)(.+?)\1/);
    if (strongMatch) {
      out.push({ kind: "strong", content: parseInline(strongMatch[2]) });
      rest = rest.slice(strongMatch[0].length);
      continue;
    }
    // Strikethrough: ~~...~~
    const delMatch = rest.match(/^~~(.+?)~~/);
    if (delMatch) {
      out.push({ kind: "del", content: parseInline(delMatch[1]) });
      rest = rest.slice(delMatch[0].length);
      continue;
    }
    // Italic: *...* (not **), _..._
    const emMatch = rest.match(/^\*(?!\*)(.+?)\*(?!\*)/);
    if (emMatch) {
      out.push({ kind: "em", content: parseInline(emMatch[1]) });
      rest = rest.slice(emMatch[0].length);
      continue;
    }
    // Link: [label](href)
    const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      const href = safeHref(linkMatch[2]);
      if (href) {
        out.push({ kind: "link", href, label: parseInline(linkMatch[1]) });
        rest = rest.slice(linkMatch[0].length);
        continue;
      }
      // Unsafe scheme: keep the literal source text.
      flushText(linkMatch[0]);
      rest = rest.slice(linkMatch[0].length);
      continue;
    }
    // Ordinary character — consume up to the next possible opener.
    const next = rest.slice(1).search(/[`[*~[]/);
    const take = next === -1 ? rest.length : next + 1;
    flushText(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return out;
}

function parseListLines(lines: string[]): { ordered: boolean; items: Inline[][] } | null {
  const ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
  const bullet = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
  const items: Inline[][] = [];
  for (const line of lines) {
    const match = line.match(bullet);
    if (!match) return null;
    items.push(parseInline(match[1]));
  }
  return { ordered, items };
}

/** Block pass: fences, headings, quotes, lists, hr, paragraphs. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence (or run off the end)
      blocks.push({ kind: "code", lang, code: body.join("\n") });
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2].replace(/\s*#+\s*$/, "")),
      });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    // Blockquote.
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      // Nested fences inside a quote stay one quote block; simple and safe.
      blocks.push({ kind: "quote", content: parseInline(quoted.join(" ")) });
      continue;
    }

    // List (consecutive bullet or ordered lines).
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const collected: string[] = [];
      while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        collected.push(lines[i]);
        i += 1;
      }
      const list = parseListLines(collected);
      if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
      else blocks.push({ kind: "paragraph", content: parseInline(collected.join(" ")) });
      continue;
    }

    // Paragraph: consume until a blank line or a block starter.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(```|#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    } else {
      // Defensive: never loop forever on an unmatched line.
      blocks.push({ kind: "paragraph", content: parseInline(lines[i]) });
      i += 1;
    }
  }
  return blocks;
}

/** Flatten an inline tree to plain text (used for titles and previews). */
export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "code":
          return node.code;
        case "link":
          return inlineText(node.label);
        default:
          return inlineText(node.content);
      }
    })
    .join("");
}
