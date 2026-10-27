# Crystal AI

Crystal AI is CrystalOS's dedicated AI application: a conversation with a real
model, streamed as it is written, with model choice from Puter's own catalogue.
It runs on **Puter.js** and Puter's *User-Pays* model.

## How the pieces fit

| Part | File | Role |
| --- | --- | --- |
| Puter runtime | `src/services/ai/puter.ts` | Lazily loads `https://js.puter.com/v2/` the first time the app opens; turns Puter error codes into sentences a person can act on |
| Conversations | `src/services/ai/store.ts` | Persisted locally under the `crescent.` namespace; settings keep model, system prompt and streaming |
| Markdown | `src/services/ai/markdown.ts` + `MarkdownView.tsx` | A small parser (pure, tested) and React renderer; raw HTML in an answer is always text, never markup |
| The app | `src/apps/ai/CrystalAi.tsx` | Sidebar of conversations, thread, composer, model catalogue, settings |

## The Puter model, stated plainly

- **CrystalOS ships no API key.** There is nothing of Puter's in this
  repository and nothing to leak. Puter.js is loaded from Puter's CDN.
- **The person signs in with their own Puter account.** Puter.js raises its
  own sign-in flow the first time a service is used; CrystalOS never sees or
  stores Puter credentials.
- **Usage is billed to that account** under Puter's User-Pays model. Free
  accounts have a monthly allowance and rate limits (30 requests / 10 seconds,
  3 concurrent). When the allowance runs out, Puter returns
  `insufficient_funds` and this app says exactly that — it does not pretend
  the model is still answering.
- **Model availability and pricing are Puter's**, not CrystalOS's. The app
  offers a few models Puter's own documentation names, plus the full live
  catalogue on request (`puter.ai.listModels()`).
- **Crystal AI needs the network.** Offline mode and a dead connection produce
  a clear sentence before any request is attempted — no half-sent turns, no
  spinner that never ends.

## Safety and privacy

- Conversations are stored in this browser profile (same local storage as the
  rest of CrystalOS) and are never uploaded anywhere except back to Puter as
  the context of the next turn — which is how a model remembers a
  conversation.
- The system prompt is optional and local. Nothing executes system-affecting
  actions: Crystal AI can write code *in an answer*, and the copy button takes
  it to the clipboard; it never runs a terminal command, touches files, or
  installs anything.
- The markdown renderer never produces HTML from answer content, so an answer
  that quotes a web page renders inert text.

## What "streaming" means here

`puter.ai.chat(messages, { stream: true })` returns an async iterable of
parts; the app appends `part.text` to the assistant turn as it arrives and the
Stop button aborts the underlying request (`AbortController` → `signal`).
Provider errors can arrive mid-stream as `{ type: "error" }` chunks and are
surfaced as themselves. With streaming off, the normalized response's
`message.content` is used (the app always passes `normalize: true` so a
vendor's native block-array shape never reaches the renderer).

## Known limitations

- Puter's sign-in popup must be allowed by the browser (it opens as part of
  the Puter.js flow). A popup blocker set to "strict" on puter.com may need a
  site exception — Crystal Shield only blocks non-gesture popups in proxied
  pages, so this is an edge case, not the default.
- If the network blocks `js.puter.com` (some corporate policies, some ad
  blockers), the app reports the script could not be loaded and offers retry —
  it does not fall back to a fake local model.
- Attachments/vision depend on the chosen model's provider support and size
  limits; the current app does not yet expose the media-attachment call form.
