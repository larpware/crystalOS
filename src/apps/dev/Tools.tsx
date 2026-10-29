import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Segmented, Textarea, TextInput } from "@/components/ui";
import { Icon, type IconName } from "@/icons/Icon";
import { notify } from "@/services/os";

/* ==========================================================================
   Developer tools

   Seven utilities that do their whole job inside this tab: no request is
   made, nothing is uploaded, and every result is computed from the text in
   front of you. That is the honest scope of browser-side tooling — the ones
   that would need a network (HTTP probing, port scanning, DNS) are not
   pretended at here.

   Each tool is a self-contained panel. Shared surface: a labelled input, the
   derived output, and an error in words when the input does not parse.
   ========================================================================== */

type ToolId = "json" | "base64" | "url" | "hash" | "timestamp" | "regex" | "color";

const TOOLS: { id: ToolId; name: string; icon: IconName; blurb: string }[] = [
  { id: "json", name: "JSON formatter", icon: "code", blurb: "Validate and pretty-print JSON" },
  { id: "base64", name: "Base64", icon: "layers", blurb: "Encode and decode UTF-8 text" },
  { id: "url", name: "URL parser", icon: "link", blurb: "Break a URL into its parts" },
  { id: "hash", name: "Hash calculator", icon: "lock", blurb: "SHA-1, SHA-256 and SHA-512" },
  { id: "timestamp", name: "Timestamp converter", icon: "clock", blurb: "Unix time ↔ readable date" },
  { id: "regex", name: "Regex tester", icon: "search", blurb: "Test a pattern against text" },
  { id: "color", name: "Colour inspector", icon: "palette", blurb: "Hex ↔ RGB ↔ HSL" },
];

function copy(value: string) {
  void navigator.clipboard
    .writeText(value)
    .then(() => notify({ title: "Crystal Dev", body: "Copied to the clipboard." }))
    .catch(() => notify({ title: "Crystal Dev", body: "The clipboard is blocked — select and copy manually." }));
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cr-dev-tool__panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/* ---- JSON --------------------------------------------------------------- */

function JsonTool() {
  const [input, setInput] = useState("{\n  \"hello\": \"world\"\n}");
  const parsed = useMemo(() => {
    if (!input.trim()) return { ok: false as const, error: "Nothing to format." };
    try {
      return { ok: true as const, value: JSON.parse(input) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Invalid JSON." };
    }
  }, [input]);

  const pretty = parsed.ok ? JSON.stringify(parsed.value, null, 2) : "";
  const minified = parsed.ok ? JSON.stringify(parsed.value) : "";

  return (
    <>
      <Panel title="Input">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={9}
          spellCheck={false}
          aria-label="JSON input"
        />
      </Panel>
      <Panel title={parsed.ok ? "Valid JSON" : "Invalid JSON"}>
        {parsed.ok ? (
          <>
            <div className="cr-dev-tool__row">
              <Badge tone="success">Parsed</Badge>
              <Button size="sm" icon="copy" onClick={() => copy(pretty)}>
                Copy formatted
              </Button>
              <Button size="sm" icon="copy" onClick={() => copy(minified)}>
                Copy minified
              </Button>
            </div>
            <pre className="cr-dev-tool__out">{pretty}</pre>
          </>
        ) : (
          <p className="cr-dev-tool__error">{parsed.error}</p>
        )}
      </Panel>
    </>
  );
}

/* ---- Base64 ------------------------------------------------------------- */

function Base64Tool() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("CrystalOS");

  const result = useMemo(() => {
    if (!input) return { ok: true as const, value: "" };
    try {
      if (mode === "encode") {
        const bytes = new TextEncoder().encode(input);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { ok: true as const, value: btoa(binary) };
      }
      const binary = atob(input.trim());
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return { ok: true as const, value: new TextDecoder().decode(bytes) };
    } catch {
      return {
        ok: false as const,
        error: mode === "decode" ? "That is not valid Base64." : "Could not encode that text.",
      };
    }
  }, [input, mode]);

  return (
    <>
      <div className="cr-dev-tool__row">
        <Segmented
          label="Direction"
          value={mode}
          onChange={setMode}
          options={[
            { value: "encode", label: "Encode" },
            { value: "decode", label: "Decode" },
          ]}
        />
      </div>
      <Panel title="Input">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={5}
          spellCheck={false}
          aria-label="Base64 input"
        />
      </Panel>
      <Panel title={mode === "encode" ? "Base64" : "Decoded text"}>
        {result.ok ? (
          <>
            <pre className="cr-dev-tool__out">{result.value || "—"}</pre>
            <div className="cr-dev-tool__row">
              <Button size="sm" icon="copy" disabled={!result.value} onClick={() => copy(result.value)}>
                Copy
              </Button>
            </div>
          </>
        ) : (
          <p className="cr-dev-tool__error">{result.error}</p>
        )}
      </Panel>
    </>
  );
}

/* ---- URL ---------------------------------------------------------------- */

function UrlTool() {
  const [input, setInput] = useState("https://example.com:8443/path?q=crystal#top");
  const parsed = useMemo(() => {
    try {
      const url = new URL(input.trim());
      return {
        ok: true as const,
        url,
        params: [...url.searchParams.entries()],
      };
    } catch {
      return { ok: false as const };
    }
  }, [input]);

  return (
    <>
      <Panel title="URL">
        <TextInput
          value={input}
          onChange={(event) => setInput(event.target.value)}
          spellCheck={false}
          aria-label="URL to parse"
        />
      </Panel>
      {parsed.ok ? (
        <>
          <Panel title="Parts">
            <dl className="cr-dev-tool__facts">
              {(
                [
                  ["Scheme", parsed.url.protocol.replace(/:$/, "")],
                  ["Origin", parsed.url.origin],
                  ["Host", parsed.url.hostname],
                  ["Port", parsed.url.port || "(default)"],
                  ["Path", parsed.url.pathname || "/"],
                  ["Fragment", parsed.url.hash ? parsed.url.hash.slice(1) : "(none)"],
                ] as [string, string][]
              ).map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd className="cr-code">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title={`Query parameters (${parsed.params.length})`}>
            {parsed.params.length === 0 ? (
              <p className="cr-row__desc">No query string.</p>
            ) : (
              <dl className="cr-dev-tool__facts">
                {parsed.params.map(([key, value], index) => (
                  <div key={`${key}-${index}`}>
                    <dt>{key}</dt>
                    <dd className="cr-code">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
        </>
      ) : (
        <p className="cr-dev-tool__error">That is not a valid absolute URL — it needs a scheme, such as https://</p>
      )}
    </>
  );
}

/* ---- Hash --------------------------------------------------------------- */

const HASH_ALGORITHMS = ["SHA-1", "SHA-256", "SHA-512"] as const;

function HashTool() {
  const [input, setInput] = useState("CrystalOS");
  const [algorithm, setAlgorithm] = useState<(typeof HASH_ALGORITHMS)[number]>("SHA-256");
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      setError("This context has no WebCrypto (it needs https:// or localhost), so no hash can be computed.");
      setDigest(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void subtle
      .digest(algorithm, new TextEncoder().encode(input))
      .then((result) => {
        if (cancelled) return;
        const bytes = new Uint8Array(result);
        setDigest([...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
      })
      .catch(() => {
        if (!cancelled) setError("Hashing failed for that input.");
      });
    return () => {
      cancelled = true;
    };
  }, [input, algorithm]);

  return (
    <>
      <div className="cr-dev-tool__row">
        <Segmented
          label="Algorithm"
          value={algorithm}
          onChange={setAlgorithm}
          options={HASH_ALGORITHMS.map((value) => ({ value, label: value }))}
        />
      </div>
      <Panel title="Input">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={4}
          spellCheck={false}
          aria-label="Text to hash"
        />
      </Panel>
      <Panel title={algorithm}>
        {error ? (
          <p className="cr-dev-tool__error">{error}</p>
        ) : (
          <>
            <pre className="cr-dev-tool__out cr-dev-tool__out--hash">{digest ?? "…"}</pre>
            <div className="cr-dev-tool__row">
              <Button size="sm" icon="copy" disabled={!digest} onClick={() => digest && copy(digest)}>
                Copy digest
              </Button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

/* ---- Timestamp ---------------------------------------------------------- */

function TimestampTool() {
  const [now, setNow] = useState(() => Date.now());
  const [value, setValue] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const parsed = useMemo(() => {
    const raw = value.trim();
    if (!raw) return null;
    if (/^\d{10}$/.test(raw)) return { kind: "ok" as const, ms: Number(raw) * 1000, assumed: "seconds" as const };
    if (/^\d{13}$/.test(raw)) return { kind: "ok" as const, ms: Number(raw), assumed: null };
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return { kind: "invalid" as const };
    return { kind: "ok" as const, ms, assumed: null };
  }, [value]);

  const date = parsed?.kind === "ok" ? new Date(parsed.ms) : null;

  return (
    <>
      <Panel title="Now">
        <dl className="cr-dev-tool__facts">
          <div>
            <dt>Unix seconds</dt>
            <dd className="cr-code">{Math.floor(now / 1000)}</dd>
          </div>
          <div>
            <dt>Unix milliseconds</dt>
            <dd className="cr-code">{now}</dd>
          </div>
          <div>
            <dt>ISO 8601</dt>
            <dd className="cr-code">{new Date(now).toISOString()}</dd>
          </div>
          <div>
            <dt>Local time</dt>
            <dd className="cr-code">{new Date(now).toString()}</dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Convert a value">
        <TextInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="1700000000, 1700000000000, or a date string"
          aria-label="Timestamp or date to convert"
        />
        {parsed?.kind === "invalid" ? (
          <p className="cr-dev-tool__error">
            Not a recognisable timestamp or date. Use Unix seconds (10 digits), Unix milliseconds (13
            digits), or something like 2026-10-29T12:00:00Z.
          </p>
        ) : date ? (
          <dl className="cr-dev-tool__facts">
            <div>
              <dt>Readable</dt>
              <dd>{date.toString()}</dd>
            </div>
            <div>
              <dt>Unix seconds</dt>
              <dd className="cr-code">{Math.floor(date.getTime() / 1000)}</dd>
            </div>
            <div>
              <dt>Unix milliseconds</dt>
              <dd className="cr-code">{date.getTime()}</dd>
            </div>
            <div>
              <dt>ISO 8601</dt>
              <dd className="cr-code">{date.toISOString()}</dd>
            </div>
            {parsed?.kind === "ok" && parsed.assumed && (
              <div>
                <dt>Interpreted as</dt>
                <dd>Unix seconds — it had 10 digits</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="cr-row__desc">Type a value to see it in every form.</p>
        )}
      </Panel>
    </>
  );
}

/* ---- Regex -------------------------------------------------------------- */

function RegexTool() {
  const [pattern, setPattern] = useState("\\b\\w+@\\w+\\.\\w+\\b");
  const [flags, setFlags] = useState("g");
  const [input, setInput] = useState("Write to ada@example.com or grace@crystalos.dev");

  const result = useMemo((): { error?: string; matches: { text: string; index: number }[] } => {
    if (!pattern) return { matches: [] };
    try {
      const regex = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
      const matches: { text: string; index: number }[] = [];
      let exec = regex.exec(input);
      while (exec && matches.length < 200) {
        matches.push({ text: exec[0], index: exec.index });
        if (!regex.global) break;
        // A zero-length match does not advance lastIndex on its own; without
        // this the loop would read the same position forever.
        if (exec[0] === "") regex.lastIndex += 1;
        exec = regex.exec(input);
      }
      return { matches };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid pattern.", matches: [] };
    }
  }, [pattern, flags, input]);

  return (
    <>
      <div className="cr-dev-tool__row">
        <TextInput
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="Pattern"
          aria-label="Regular expression pattern"
          spellCheck={false}
        />
        <TextInput
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
          placeholder="flags"
          aria-label="Regular expression flags"
          className="cr-dev-tool__flags"
          spellCheck={false}
        />
      </div>
      <Panel title="Test string">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={4}
          spellCheck={false}
          aria-label="Text to test against"
        />
      </Panel>
      <Panel title={result.error ? "Invalid pattern" : `Matches (${result.matches.length})`}>
        {result.error ? (
          <p className="cr-dev-tool__error">{result.error}</p>
        ) : result.matches.length === 0 ? (
          <p className="cr-row__desc">No match in that text.</p>
        ) : (
          <ul className="cr-dev-tool__matches">
            {result.matches.map((match, index) => (
              <li key={`${match.index}-${index}`}>
                <span className="cr-code">{match.text}</span>
                <span className="cr-row__desc">at {match.index}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/* ---- Colour ------------------------------------------------------------- */

function parseHex(value: string): { r: number; g: number; b: number } | null {
  const raw = value.trim().replace(/^#/, "");
  const full = raw.length === 3 ? [...raw].map((char) => char + char).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === rr) hue = ((gg - bb) / delta) % 6;
    else if (max === gg) hue = (bb - rr) / delta + 2;
    else hue = (rr - gg) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [Math.round(hue), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function ColorTool() {
  const [value, setValue] = useState("#4f8cff");
  const rgb = parseHex(value);

  return (
    <>
      <Panel title="Colour">
        <div className="cr-dev-tool__row">
          <input
            type="color"
            className="cr-dev-tool__swatch-input"
            value={rgb ? `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, "0")).join("")}` : "#000000"}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Pick a colour"
          />
          <TextInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="#4f8cff"
            aria-label="Hex colour"
            spellCheck={false}
          />
          <span
            className="cr-dev-tool__swatch"
            style={{ background: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : "transparent" }}
            aria-hidden="true"
          />
        </div>
      </Panel>
      <Panel title="Values">
        {rgb ? (
          <dl className="cr-dev-tool__facts">
            <div>
              <dt>HEX</dt>
              <dd className="cr-code">
                #{[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, "0")).join("")}
              </dd>
            </div>
            <div>
              <dt>RGB</dt>
              <dd className="cr-code">
                rgb({rgb.r}, {rgb.g}, {rgb.b})
              </dd>
            </div>
            <div>
              <dt>HSL</dt>
              <dd className="cr-code">
                {(() => {
                  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
                  return `hsl(${h}, ${s}%, ${l}%)`;
                })()}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="cr-dev-tool__error">
            Not a hex colour — use #rgb or #rrggbb, such as #4f8cff.
          </p>
        )}
      </Panel>
    </>
  );
}

/* ---- Shell -------------------------------------------------------------- */

export function Tools() {
  const [active, setActive] = useState<ToolId>("json");
  const tool = TOOLS.find((entry) => entry.id === active) ?? TOOLS[0];

  return (
    <div className="cr-dev__pane cr-dev-tools">
      <header className="cr-dev__pane-head">
        <div>
          <h2>Tools</h2>
          <p className="cr-row__desc">
            Every utility here runs entirely on this machine — no request leaves the tab.
          </p>
        </div>
      </header>

      <div className="cr-dev-tools__body">
        <nav className="cr-dev-tools__list" aria-label="Developer tools">
          {TOOLS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="cr-dev-tools__item"
              data-active={entry.id === active}
              onClick={() => setActive(entry.id)}
            >
              <Icon name={entry.icon} size={14} />
              <span className="cr-dev-tools__item-text">
                <span>{entry.name}</span>
                <span className="cr-row__desc">{entry.blurb}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="cr-dev-tool__panels">
          <h2 className="cr-dev-tool__title">{tool.name}</h2>
          {active === "json" && <JsonTool />}
          {active === "base64" && <Base64Tool />}
          {active === "url" && <UrlTool />}
          {active === "hash" && <HashTool />}
          {active === "timestamp" && <TimestampTool />}
          {active === "regex" && <RegexTool />}
          {active === "color" && <ColorTool />}
        </div>
      </div>
    </div>
  );
}

export default Tools;
