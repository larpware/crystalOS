import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  Modal,
  Row,
  Section,
  Segmented,
  Select,
  Spinner,
  TextInput,
  Textarea,
  Switch,
  type MenuItem,
} from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify } from "@/services/os";
import { useOffline } from "@/hooks/useOffline";
import { offlineExplanation } from "@/services/offline";
import {
  describePuterError,
  loadPuter,
  puterReady,
  puterState,
  subscribePuter,
  type PuterChatMessage,
  type PuterModelInfo,
  type PuterStreamPart,
} from "@/services/ai/puter";
import {
  chatThroughGateway,
  describeGatewayError,
  GATEWAY_SUGGESTED_MODELS,
  listGatewayModels,
} from "@/services/ai/gateway";
import {
  activeModel,
  SUGGESTED_MODELS,
  useAiStore,
  type AiConversation,
  type AiTurn,
} from "@/services/ai/store";
import { Markdown } from "@/services/ai/MarkdownView";
import type { AppProps } from "@/types";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Crystal AI

   A conversation with a model, through Puter.js — Puter's User-Pays model, so
   the person signs in with their own Puter account and their usage is theirs.
   Settings → Routing can send the same conversation through the local Respan
   Gateway instead, which spends the developer's own provider keys; the app
   holds no key either way, sees no credential, and never pretends an answer
   arrived when it did not.

   Every failure has a face: the script that will not load, the account out of
   credit, the rate limit, the dropped connection. The composer stays usable,
   the stop button works mid-stream, and conversations are this machine's own
   data — persisted locally, never uploaded anywhere except back to Puter as
   the context of the next turn.
   ========================================================================== */

function turnId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CrystalAi({ args }: AppProps) {
  const conversations = useAiStore((state) => state.conversations);
  const activeId = useAiStore((state) => state.activeId);
  const settings = useAiStore((state) => state.settings);
  const busyId = useAiStore((state) => state.busyConversationId);
  const store = useAiStore;
  const offline = useOffline();

  const [draft, setDraft] = useState("");
  const [runtime, setRuntime] = useState(puterState());
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [allModels, setAllModels] = useState<PuterModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribePuter(() => setRuntime(puterState())), []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const busy = busyId !== null && busyId === active?.id;
  const usingGateway = settings.provider === "gateway";
  const chosenModel = activeModel(settings);

  const updateModel = useCallback(
    (value: string) => {
      store.getState().updateSettings(usingGateway ? { gatewayModel: value } : { model: value });
    },
    [store, usingGateway],
  );

  /* An app that opens on nothing opens on a fresh conversation, so the first
     thing on screen is a composer, not a choreography of clicks. */
  useEffect(() => {
    if (conversations.length === 0) store.getState().newConversation();
    else if (!activeId && conversations[0]) store.getState().select(conversations[0].id);
  }, [conversations.length, activeId, store]);

  /* A launch argument names a conversation to open (used by search/terminal). */
  useEffect(() => {
    const requested = typeof args?.conversationId === "string" ? args.conversationId : null;
    if (!requested) return;
    if (store.getState().conversations.some((c) => c.id === requested)) {
      store.getState().select(requested);
    }
  }, [args?.conversationId, store]);

  /* Keep the newest turn in view while streaming. */
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [active?.turns.length, busy]);

  const ensureRuntime = useCallback(async (): Promise<boolean> => {
    /* A gateway turn never touches Puter, so there is no script to load. */
    if (usingGateway) return true;
    if (puterReady()) return true;
    try {
      await loadPuter();
      setRuntimeError(null);
      return true;
    } catch (error) {
      const message = describePuterError(error);
      setRuntimeError(message);
      setRuntime(puterState());
      return false;
    }
  }, [usingGateway]);

  useEffect(() => {
    void ensureRuntime();
  }, [ensureRuntime]);

  const loadAllModels = useCallback(async () => {
    setModelsError(null);
    if (usingGateway) {
      try {
        const ids = await listGatewayModels(settings.gatewayUrl);
        setAllModels(ids.map((id) => ({ id })));
      } catch (error) {
        setModelsError(describeGatewayError(error));
      }
      return;
    }
    if (!(await ensureRuntime())) return;
    try {
      const listed = await window.puter?.ai?.listModels?.();
      const models: PuterModelInfo[] = Array.isArray(listed)
        ? listed
        : Object.keys(listed ?? {}).map((id) => ({ id }));
      setAllModels(models.sort((a, b) => a.id.localeCompare(b.id)));
    } catch (error) {
      setModelsError(describePuterError(error));
    }
  }, [ensureRuntime, settings.gatewayUrl, usingGateway]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const state = store.getState();
    /* If the model had not said anything yet, say so — an empty assistant
       turn with no explanation reads as a rendering fault, not a stop. */
    const conversation = state.conversations.find((c) => c.id === state.busyConversationId);
    const last = conversation?.turns[conversation.turns.length - 1];
    if (last && last.role === "assistant" && last.content.trim() === "" && !last.error) {
      state.patchTurn(conversation.id, last.id, {
        content: "",
        error: "Stopped before the answer started.",
      });
    }
    state.setBusy(null);
  }, [store]);

  /**
   * The request itself, shared by Send and Regenerate.
   *
   * The answer turn must already exist and be the one being streamed into;
   * `historyTurns` are the turns to send as context — for a regenerate that
   * deliberately excludes the answer being replaced, so the model never sees
   * its own previous attempt as history.
   */
  const runAnswer = useCallback(
    async (conversationId: string, answerId: string, historyTurns: AiTurn[]) => {
      const state = store.getState();
      const model = activeModel(state.settings);
      const throughGateway = state.settings.provider === "gateway";

      const history = historyTurns
        .filter((t) => !t.error && (t.content.trim() !== "" || t.role === "user"))
        .slice(-40)
        .map((t) => ({ role: t.role, content: t.content }) as PuterChatMessage);

      const messages: PuterChatMessage[] = state.settings.systemPrompt.trim()
        ? [{ role: "system", content: state.settings.systemPrompt.trim() }, ...history]
        : history;

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (content: string, error?: string) =>
        store.getState().patchTurn(conversationId, answerId, { content, ...(error ? { error } : {}) });

      try {
        /* The gateway path is the same conversation, sent to the local gateway
           instead of Puter: one request, streamed into the same answer turn. */
        if (throughGateway) {
          let accumulated = "";
          for await (const delta of chatThroughGateway({
            baseUrl: state.settings.gatewayUrl,
            model,
            messages,
            stream: state.settings.stream,
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) break;
            accumulated += delta;
            patch(accumulated);
          }
          if (!controller.signal.aborted && accumulated.trim() === "") {
            patch("", "The model returned an empty answer. Try again or pick another model.");
          }
          return;
        }

        const response = await window.puter!.ai!.chat(messages, {
          model,
          // normalize guarantees OpenAI-style `message.content` as a string,
          // so a vendor's native block-array shape never reaches the renderer.
          normalize: true,
          stream: state.settings.stream,
          signal: controller.signal,
        });

        if (state.settings.stream && Symbol.asyncIterator in Object(response)) {
          let accumulated = "";
          for await (const part of response as AsyncIterable<PuterStreamPart>) {
            if (controller.signal.aborted) break;
            if (part?.type === "error") {
              patch(accumulated, describePuterError(part.message ?? "The model reported an error."));
              return;
            }
            if (typeof part?.text === "string") {
              accumulated += part.text;
              patch(accumulated);
            }
          }
          if (!controller.signal.aborted && accumulated.trim() === "") {
            patch("", "The model returned an empty answer. Try again or pick another model.");
          }
        } else {
          const responseMessage = (response as { message?: { content?: unknown } }).message;
          const content =
            typeof responseMessage?.content === "string"
              ? responseMessage.content
              : JSON.stringify(responseMessage?.content ?? "", null, 2);
          patch(content || "The model returned an empty answer.");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          const current =
            store.getState().conversations.find((c) => c.id === conversationId)?.turns.find(
              (t) => t.id === answerId,
            ) ?? null;
          if (current && current.content.trim() === "") {
            patch("(stopped before any answer arrived)");
          }
        } else {
          const current =
            store.getState().conversations.find((c) => c.id === conversationId)?.turns.find(
              (t) => t.id === answerId,
            ) ?? null;
          patch(
            current?.content ?? "",
            throughGateway ? describeGatewayError(error) : describePuterError(error),
          );
        }
      } finally {
        abortRef.current = null;
        store.getState().setBusy(null);
      }
    },
    [store],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const state = store.getState();
    const conversationId = state.activeId ?? state.newConversation();

    if (offline.offline) {
      const turn: AiTurn = {
        id: turnId(),
        role: "assistant",
        content: "",
        error:
          "CrystalOS is offline, so no request was made. " + offlineExplanation(offline),
        createdAt: Date.now(),
      };
      state.appendTurn(conversationId, turn);
      return;
    }

    if (!(await ensureRuntime())) return;

    setDraft("");
    const userTurn: AiTurn = { id: turnId(), role: "user", content: text, createdAt: Date.now() };
    state.appendTurn(conversationId, userTurn);

    const answerId = turnId();
    state.appendTurn(conversationId, {
      id: answerId,
      role: "assistant",
      content: "",
      model: activeModel(state.settings),
      createdAt: Date.now(),
    });
    state.setBusy(conversationId);

    const turns = store.getState().conversations.find((c) => c.id === conversationId)?.turns ?? [];
    await runAnswer(conversationId, answerId, turns);
  }, [busy, draft, ensureRuntime, offline, store, runAnswer]);

  /*
   * Regenerate the last answer: the turn is cleared in place rather than
   * deleted, so the history the user sees stays continuous, and the request
   * goes out with that turn excluded from its own context.
   */
  const regenerate = useCallback(async () => {
    const state = store.getState();
    const conversation = state.conversations.find((c) => c.id === state.activeId);
    if (!conversation || busy) return;
    const turns = conversation.turns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== "assistant") return;
    if (turns.slice(0, -1).every((turn) => turn.role !== "user")) return;
    if (offline.offline || !(await ensureRuntime())) return;

    state.patchTurn(conversation.id, last.id, {
      content: "",
      error: undefined,
      model: activeModel(state.settings),
      createdAt: Date.now(),
    });
    state.setBusy(conversation.id);
    await runAnswer(conversation.id, last.id, turns.slice(0, -1));
  }, [busy, ensureRuntime, offline, runAnswer, store]);

  /** Copies an answer the way the composer's users expect: clipboard first,
      and an honest word when the browser refuses it. */
  const copyTurn = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => notify({ title: "Crystal AI", body: "Response copied to the clipboard." }))
      .catch(() =>
        notify({
          title: "Crystal AI",
          body: "The clipboard is blocked here — select the text and copy it instead.",
        }),
      );
  };

  const modelOptions = useMemo(() => {
    const base = (usingGateway ? GATEWAY_SUGGESTED_MODELS : SUGGESTED_MODELS).map((m) => ({
      value: m.id,
      label: m.label,
    }));
    // The configured model is always offered, even before the catalogue loads.
    const listed = [
      ...(usingGateway ? [settings.gatewayModel] : []),
      ...(allModels ?? []).map((m) => m.id),
    ];
    const known = new Set(base.map((b) => b.value));
    const extra = listed
      .filter((id) => id.trim() !== "" && !known.has(id))
      .slice(0, 400)
      .map((id) => ({ value: id, label: id }));
    return [...base, ...extra];
  }, [allModels, settings.gatewayModel, usingGateway]);

  const menuItems: MenuItem[] = menu
    ? [
        {
          id: "rename",
          label: "Rename",
          icon: "pencil",
          run: () => {
            const current = store.getState().conversations.find((c) => c.id === menu.id);
            const title = window.prompt("Conversation name", current?.title ?? "");
            if (title !== null) store.getState().rename(menu.id, title);
          },
        },
        {
          id: "delete",
          label: "Delete",
          icon: "trash",
          danger: true,
          run: () => store.getState().remove(menu.id),
        },
      ]
    : [];

  return (
    <div className="cr-ai">
      <aside className="cr-ai__side">
        <div className="cr-ai__side-head">
          <Button
            variant="primary"
            icon="plus"
            onClick={() => store.getState().newConversation()}
          >
            New chat
          </Button>
          <IconButton
            label="AI settings"
            icon="settings"
            onClick={() => setSettingsOpen(true)}
          />
        </div>
        <div className="cr-ai__list" role="list">
          {conversations.map((conversation: AiConversation) => (
            <div
              key={conversation.id}
              className="cr-ai__item"
              data-active={conversation.id === active?.id}
              role="listitem"
            >
              <button
                type="button"
                className="cr-ai__item-main"
                onClick={() => store.getState().select(conversation.id)}
              >
                <span className="cr-ai__item-title">{conversation.title}</span>
                <span className="cr-ai__item-meta">{formatRelative(conversation.updatedAt)}</span>
              </button>
              <IconButton
                label={`Actions for ${conversation.title}`}
                icon="more-vertical"
                onClick={(event) => {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ x: rect.left, y: rect.bottom + 4, id: conversation.id });
                }}
              />
            </div>
          ))}
        </div>
        <footer className="cr-ai__side-foot">
          <Icon name="sparkle" size={12} />
          <span>
            {usingGateway
              ? "Routed through the local Respan Gateway — your provider's keys, not CrystalOS's."
              : "Powered by Puter.js — AI usage is billed to your Puter account, not CrystalOS."}
          </span>
        </footer>
      </aside>

      <main className="cr-ai__main">
        {!usingGateway && runtime.status === "loading" && (
          <div className="cr-ai__runtime">
            <Spinner label="Loading Puter.js" />
          </div>
        )}
        {!usingGateway && runtime.status === "error" && (
          <EmptyState
            icon="warning"
            title="Crystal AI could not start"
            hint={runtimeError ?? "Puter.js could not be loaded."}
            action={
              <Button icon="refresh" onClick={() => void ensureRuntime()}>
                Try again
              </Button>
            }
          />
        )}
        {offline.offline && (usingGateway || runtime.status !== "error") && (
          <div className="cr-ai__notice">
            <Icon name="wifi-off" size={14} />
            <span>
              {offline.reason === "forced"
                ? "Offline mode is on, so Crystal AI will not send anything. Turn it off in Quick Settings to talk to a model."
                : usingGateway
                  ? "No network connection. The gateway on this machine needs one to reach its provider."
                  : "No network connection. Crystal AI needs one — it talks to Puter's cloud."}
            </span>
          </div>
        )}

        <div className="cr-ai__thread" ref={scrollRef}>
          {active && active.turns.length === 0 && (
            <EmptyState
              icon="sparkle"
              title="What are we working on?"
              hint="Ask anything. Answers stream in as they are written; code blocks come with a copy button. Conversations stay on this machine."
            />
          )}
          {active?.turns.map((turn) => (
            <article
              key={turn.id}
              className={`cr-ai__turn cr-ai__turn--${turn.role}`}
              data-error={Boolean(turn.error)}
            >
              <header className="cr-ai__turn-head">
                <Icon name={turn.role === "user" ? "user" : "sparkle"} size={13} />
                <span>{turn.role === "user" ? "You" : (turn.model ?? "Assistant")}</span>
                {turn.error && <Badge tone="danger" icon="warning">Error</Badge>}
                {turn.role === "assistant" && !busy && (turn.content.trim() !== "" || turn.error) && (
                  <span className="cr-ai__turn-actions">
                    {turn.content.trim() !== "" && (
                      <IconButton
                        label="Copy response"
                        icon="copy"
                        size={13}
                        onClick={() => copyTurn(turn.content)}
                      />
                    )}
                    {turn.id === active?.turns[active.turns.length - 1]?.id && (
                      <IconButton
                        label={turn.error ? "Try again" : "Regenerate"}
                        icon="refresh"
                        size={13}
                        onClick={() => void regenerate()}
                      />
                    )}
                  </span>
                )}
              </header>
              {turn.role === "user" ? (
                <p className="cr-ai__user-text">{turn.content}</p>
              ) : turn.error ? (
                <p className="cr-ai__error-text">{turn.error}</p>
              ) : turn.content.trim() === "" &&
                  busy &&
                  turn.id === active?.turns[active.turns.length - 1]?.id ? (
                <div className="cr-ai__thinking">
                  <Spinner label="Thinking" />
                </div>
              ) : (
                <Markdown source={turn.content} />
              )}
            </article>
          ))}
        </div>

        <div className="cr-ai__composer">
          <div className="cr-ai__composer-models">
            <Select
              aria-label="Model"
              value={chosenModel}
              onChange={(event) => updateModel(event.target.value)}
              options={modelOptions}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setModelsOpen((open) => !open);
                if (!allModels && !modelsOpen) void loadAllModels();
              }}
            >
              {allModels ? `All models (${allModels.length})` : "Load all models"}
            </Button>
            <Switch
              label="Stream answers"
              checked={settings.stream}
              onChange={(stream) => store.getState().updateSettings({ stream })}
            />
          </div>
          {modelsError && <p className="cr-ai__composer-error">{modelsError}</p>}
          <div className="cr-ai__composer-row">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={
                offline.offline ? "Offline — no request will be sent" : "Message Crystal AI…"
              }
              aria-label="Message Crystal AI"
            />
            {busy ? (
              <Button variant="danger" icon="close" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="send"
                disabled={!draft.trim()}
                onClick={() => void send()}
              >
                Send
              </Button>
            )}
          </div>
        </div>
      </main>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      <Modal
        open={settingsOpen}
        title="Crystal AI settings"
        onClose={() => setSettingsOpen(false)}
      >
        <Section
          title="Routing"
          description="Answers come from Puter.js by default. The local Respan Gateway is the other way: a small process on this machine (`npm run ai:gateway`) that spends your own provider key and serves the same OpenAI chat API."
        >
          <Row
            label="Answers from"
            description="Puter.js uses your Puter account. The local gateway uses the provider key in its own environment and needs no account."
            control={
              <Segmented
                label="Where answers come from"
                value={settings.provider}
                options={[
                  { value: "puter", label: "Puter.js" },
                  { value: "gateway", label: "Local gateway" },
                ]}
                onChange={(provider) => store.getState().updateSettings({ provider })}
              />
            }
          />
          {usingGateway && (
            <>
              <Row
                label="Gateway URL"
                description="The address `npm run ai:gateway` prints, with /v1 on the end. Loopback only: it spends the provider key of whoever started it."
                stacked
              >
                <TextInput
                  value={settings.gatewayUrl}
                  onChange={(event) =>
                    store.getState().updateSettings({ gatewayUrl: event.target.value })
                  }
                  placeholder="http://127.0.0.1:8790/v1"
                  aria-label="Gateway URL"
                />
              </Row>
              <Row
                label="Gateway model"
                description="The model name the gateway routes, e.g. gpt-4o-mini. Which names exist depends on the providers its configuration declares."
                stacked
              >
                <TextInput
                  value={settings.gatewayModel}
                  onChange={(event) =>
                    store.getState().updateSettings({ gatewayModel: event.target.value })
                  }
                  placeholder="gpt-4o-mini"
                  aria-label="Gateway model"
                />
              </Row>
            </>
          )}
        </Section>
        <Section
          title="Assistant"
          description="A system prompt shapes every answer in every conversation until you change it."
        >
          <Row
            label="System prompt"
            description="Example: “Answer in British English, keep code in TypeScript, be brief.”"
            stacked
          >
            <Textarea
              value={settings.systemPrompt}
              onChange={(event) =>
                store.getState().updateSettings({ systemPrompt: event.target.value })
              }
              rows={3}
              placeholder="Optional"
              aria-label="System prompt"
            />
          </Row>
          <Row
            label="Puter model"
            description="Used when answers come from Puter.js. Availability and pricing are Puter's; free accounts have a monthly allowance."
            control={
              <Select
                aria-label="Puter model"
                value={settings.model}
                onChange={(event) =>
                  store.getState().updateSettings({ model: event.target.value })
                }
                options={SUGGESTED_MODELS.map((m) => ({ value: m.id, label: m.label }))}
              />
            }
          />
          <Row
            label="Stream answers"
            description="Off means the whole answer arrives at once — sometimes steadier on slow links."
            control={
              <Switch
                label="Stream answers"
                checked={settings.stream}
                onChange={(stream) => store.getState().updateSettings({ stream })}
              />
            }
          />
        </Section>
        <Section
          title="Your data"
          description="Conversations are stored in this browser profile under the same local storage as the rest of CrystalOS. They are never uploaded anywhere except back to the model — Puter, or the gateway and the provider behind it — as the context of the next turn, which is how a model remembers the conversation."
        >
          <Row
            label="Delete all conversations"
            description="Removes every conversation from this machine. This cannot be undone."
            control={
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  const state = store.getState();
                  for (const conversation of [...state.conversations]) state.remove(conversation.id);
                  state.newConversation();
                  setSettingsOpen(false);
                }}
              >
                Delete all
              </Button>
            }
          />
        </Section>
      </Modal>

      {modelsOpen && (
        <div
          className="cr-ai__models-panel"
          role="dialog"
          aria-label={usingGateway ? "Models from the gateway" : "Models from Puter"}
        >
          <header>
            <span>{usingGateway ? "Models from the gateway" : "Models from Puter"}</span>
            <IconButton
              label="Close model catalogue"
              icon="close"
              onClick={() => setModelsOpen(false)}
            />
          </header>
          {modelsError ? (
            <p className="cr-ai__composer-error">{modelsError}</p>
          ) : allModels ? (
            <div className="cr-ai__models-grid">
              {allModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className="cr-ai__models-item"
                  data-active={model.id === chosenModel}
                  onClick={() => {
                    updateModel(model.id);
                    setModelsOpen(false);
                  }}
                >
                  <span>{model.id}</span>
                  {model.provider && <small>{model.provider}</small>}
                </button>
              ))}
            </div>
          ) : (
            <div className="cr-ai__thinking">
              <Spinner
                label={usingGateway ? "Loading the catalogue from the gateway" : "Loading the catalogue from Puter"}
              />
            </div>
          )}
          <p className="cr-ai__models-note">
            {usingGateway
              ? "Catalogue as reported by the gateway's providers. Availability and pricing are theirs."
              : "Catalogue as reported by Puter. Availability and pricing are Puter's."}
          </p>
        </div>
      )}
    </div>
  );
}
