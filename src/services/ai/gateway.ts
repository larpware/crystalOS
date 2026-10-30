/* ==========================================================================
   Crystal AI — the local Respan Gateway transport

   Crystal AI normally answers through Puter.js in the page. With Settings →
   Routing → Local gateway it answers through the Respan Gateway instead: a
   small process on this machine (`npm run ai:gateway`) that serves the OpenAI
   chat-completions API and spends the developer's own provider keys.

   The shell holds no credential here. The gateway reads its provider key from
   its own environment, so nothing key-shaped reaches this file, the browser
   code, or the build. The base URL is a setting because a gateway on another
   loopback port — or any OpenAI-compatible endpoint — is a text field away.

   Streaming is read the way the gateway writes it: SSE blocks whose `choices[0]
   .delta.content` is appended as it arrives. An error mid-stream becomes the
   answer's error text; the person is told what happened rather than shown a
   conversation that quietly stops.
   ========================================================================== */

/** The port `npm run ai:gateway` uses, with the `/v1` the API lives under. */
export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8790/v1";

/** The gateway serves the OpenAI chat shape; its messages are these. */
export interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Models offered before asking the gateway for its own catalogue. */
export const GATEWAY_SUGGESTED_MODELS: { id: string; label: string }[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
];

/** One parsed event from the gateway's stream. */
export interface GatewayStreamEvent {
  /** Text the model wrote in this event. */
  text?: string;
  /** A failure the gateway reported in the stream itself. */
  error?: string;
  /** The end-of-stream marker. */
  done?: boolean;
}

/**
 * Trims a typed base URL, drops trailing slashes and gives it the `/v1` the
 * chat API hangs off — so `http://127.0.0.1:8790`, `…/v1` and `…/v1/` are the
 * same gateway to the person who typed them.
 */
export function normaliseGatewayBase(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return DEFAULT_GATEWAY_URL;
  return /\/v1$/.test(value) ? value : `${value}/v1`;
}

/**
 * Reads one SSE block (`data: {...}` lines between blank lines) into an event.
 * Comments, event names and frames that are not the shape this API promises
 * are ignored rather than treated as answers — a noisy stream still renders.
 */
export function readGatewayEvent(block: string): GatewayStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return null;
  if (data === "[DONE]") return { done: true };

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  return readGatewayPayload(payload);
}

/** The text (or error) inside one chat-completion or chunk object. */
export function readGatewayPayload(payload: unknown): GatewayStreamEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { error?: unknown; choices?: unknown };

  if (record.error !== undefined && record.error !== null) {
    const message =
      typeof record.error === "string"
        ? record.error
        : String((record.error as { message?: unknown }).message ?? "");
    return { error: message.trim() || "The gateway reported an error." };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as
    | { delta?: { content?: unknown }; message?: { content?: unknown } }
    | undefined;
  if (!first) return null;

  // A streamed chunk carries `delta`; a whole answer carries `message`.
  const text =
    typeof first.delta?.content === "string"
      ? first.delta.content
      : typeof first.message?.content === "string"
        ? first.message.content
        : undefined;
  return text === undefined ? null : { text };
}

/** A sentence for a failure, naming the command that starts the gateway. */
export function describeGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.trim()) return "The gateway request failed without saying why.";
  if (/failed to fetch|networkerror|load failed|fetch failed|connection refused/i.test(message)) {
    return "The local Respan Gateway is not answering. Start it with `npm run ai:gateway` (it needs the provider key named in server/ai-gateway/gateway.toml), then send again.";
  }
  return message;
}

/** The readable failure inside a non-2xx response, or a status-based fallback. */
async function gatewayFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as unknown;
    const parsed = readGatewayPayload(body);
    detail = parsed?.error ?? "";
    if (!detail && typeof body === "object" && body !== null) {
      const error = (body as { error?: { message?: unknown } }).error;
      detail = String(error?.message ?? "");
    }
  } catch {
    /* a failure body is a convenience, never a requirement */
  }

  if (detail) return `The gateway could not answer: ${detail}`;

  if (response.status === 401 || response.status === 403) {
    return `The gateway refused the request (${response.status}). The provider key it was started with is missing or not accepted.`;
  }
  if (response.status === 404) {
    return "The gateway has no route for that model. Check the name against Settings → Routing, or the providers gateway.toml declares.";
  }
  return `The gateway answered ${response.status} and did not say why.`;
}

export interface GatewayChatOptions {
  /** Base URL from settings; normalised here, so a bare host works too. */
  baseUrl: string;
  model: string;
  messages: GatewayMessage[];
  stream: boolean;
  signal?: AbortSignal;
}

/**
 * Sends one chat through the gateway and yields the answer as it arrives: one
 * string per delta while streaming, or one string for a whole answer. A
 * failure — an unreachable gateway, a refused request, an error frame
 * mid-stream — throws an `Error` whose message is safe to show.
 */
export async function* chatThroughGateway(
  options: GatewayChatOptions,
): AsyncGenerator<string, void, void> {
  const base = normaliseGatewayBase(options.baseUrl);
  const streaming = options.stream;

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: streaming ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: streaming,
      }),
      signal: options.signal,
    });
  } catch (error) {
    // An abort is the person pressing Stop, not a failure to report.
    if (options.signal?.aborted) return;
    throw new Error(describeGatewayError(error));
  }

  if (!response.ok) throw new Error(await gatewayFailure(response));

  if (!streaming) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (options.signal?.aborted) return;
      throw new Error("The gateway answered with something that was not a completion.");
    }
    const event = readGatewayPayload(payload);
    if (event?.error) throw new Error(event.error);
    if (event?.text !== undefined) yield event.text;
    return;
  }

  if (!response.body) {
    throw new Error("The gateway's stream could not be read in this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeEvents = (): GatewayStreamEvent[] => {
    const events: GatewayStreamEvent[] = [];
    // Blocks are separated by a blank line; both endings occur in the wild.
    const separator = /\r?\n\r?\n/;
    for (;;) {
      const match = separator.exec(buffer);
      if (!match) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = readGatewayEvent(block);
      if (event) events.push(event);
    }
    return events;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const event of takeEvents()) {
        if (event.error) {
          await reader.cancel().catch(() => undefined);
          throw new Error(event.error);
        }
        if (event.text !== undefined) yield event.text;
      }
    }

    // A final block without its blank line is still a block.
    buffer += decoder.decode();
    const tail = readGatewayEvent(buffer);
    if (tail?.error) throw new Error(tail.error);
    if (tail?.text !== undefined) yield tail.text;
  } finally {
    reader.releaseLock();
  }
}

/**
 * The models the gateway reports, sorted, for the model picker. Asks
 * `/v1/models`, which the gateway fills from its providers — so the list is
 * whatever the keys it was started with can actually reach.
 */
export async function listGatewayModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = normaliseGatewayBase(baseUrl);
  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    throw new Error(describeGatewayError(error));
  }
  if (!response.ok) throw new Error(await gatewayFailure(response));

  const body = (await response.json()) as { data?: { id?: unknown }[] } | null;
  const ids: string[] = [];
  for (const model of body?.data ?? []) {
    if (typeof model?.id === "string" && model.id.trim() !== "") ids.push(model.id);
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
