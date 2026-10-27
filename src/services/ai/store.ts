import { create } from "zustand";
import { loadJSON, saveJSON } from "@/services/storage";

/* ==========================================================================
   Crystal AI — conversations

   Conversations live on this machine, under the same `crescent.` namespace as
   everything else CrystalOS remembers. They are the person's own words and the
   model's answers; they are never sent anywhere except back to Puter as the
   context of the next turn, which is what the person asked for by typing.

   Settings keep the chosen model, the optional system prompt and whether to
   stream — all per-profile, all persisted, all read by the same store the
   toolbar reads, so the UI cannot disagree with itself.
   ========================================================================== */

export type AiRole = "user" | "assistant" | "system";

export interface AiTurn {
  id: string;
  role: Exclude<AiRole, "system">;
  content: string;
  /** Model that produced an assistant turn, when known. */
  model?: string;
  /** Set when this turn failed; the text is what was received, if anything. */
  error?: string;
  createdAt: number;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: AiTurn[];
}

export interface AiSettings {
  model: string;
  systemPrompt: string;
  stream: boolean;
}

/**
 * The models offered without asking Puter for the full catalogue. Every id
 * here is one Puter's own documentation names in its examples; the app also
 * offers "all models Puter lists" once it has asked the service.
 */
export const SUGGESTED_MODELS: { id: string; label: string; note: string }[] = [
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", note: "Puter's default — fast, cheap" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Strong general reasoning" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Long answers, code" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", note: "Very fast" },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: "gpt-5.4-nano",
  systemPrompt: "",
  stream: true,
};

const STORAGE_KEY = "ai.conversations.v1";
const SETTINGS_KEY = "ai.settings.v1";
const MAX_CONVERSATIONS = 200;
const MAX_TURNS_PER_CONVERSATION = 400;

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeConversations(value: unknown): AiConversation[] {
  if (!Array.isArray(value)) return [];
  const out: AiConversation[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") continue;
    if (!Array.isArray(record.turns)) continue;
    const turns: AiTurn[] = [];
    for (const turn of record.turns) {
      if (typeof turn !== "object" || turn === null) continue;
      const t = turn as Record<string, unknown>;
      if (typeof t.id !== "string") continue;
      if (t.role !== "user" && t.role !== "assistant") continue;
      if (typeof t.content !== "string") continue;
      turns.push({
        id: t.id,
        role: t.role,
        content: t.content,
        model: typeof t.model === "string" ? t.model : undefined,
        error: typeof t.error === "string" ? t.error : undefined,
        createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
      });
    }
    out.push({
      id: record.id,
      title: record.title,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      turns: turns.slice(-MAX_TURNS_PER_CONVERSATION),
    });
  }
  return out.slice(0, MAX_CONVERSATIONS);
}

function sanitizeSettings(value: unknown): AiSettings {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_AI_SETTINGS };
  const record = value as Record<string, unknown>;
  return {
    model: typeof record.model === "string" && record.model ? record.model : DEFAULT_AI_SETTINGS.model,
    systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : "",
    stream: typeof record.stream === "boolean" ? record.stream : true,
  };
}

interface AiStoreState {
  conversations: AiConversation[];
  activeId: string | null;
  settings: AiSettings;
  /** Turn currently being produced, per conversation; null when idle. */
  busyConversationId: string | null;
  newConversation: () => string;
  select: (id: string | null) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  appendTurn: (conversationId: string, turn: AiTurn) => void;
  patchTurn: (conversationId: string, turnId: string, patch: Partial<AiTurn>) => void;
  setBusy: (conversationId: string | null) => void;
  updateSettings: (patch: Partial<AiSettings>) => void;
}

function persist(conversations: AiConversation[]): void {
  saveJSON(STORAGE_KEY, conversations);
}

export const useAiStore = create<AiStoreState>((set, get) => ({
  conversations: sanitizeConversations(loadJSON<unknown>(STORAGE_KEY, [])),
  activeId: null,
  settings: sanitizeSettings(loadJSON<unknown>(SETTINGS_KEY, null)),
  busyConversationId: null,

  newConversation: () => {
    const conversation: AiConversation = {
      id: createId(),
      title: "New conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };
    const conversations = [conversation, ...get().conversations].slice(0, MAX_CONVERSATIONS);
    persist(conversations);
    set({ conversations, activeId: conversation.id });
    return conversation.id;
  },

  select: (id) => set({ activeId: id }),

  rename: (id, title) => {
    const trimmed = title.trim().slice(0, 80) || "Untitled conversation";
    const conversations = get().conversations.map((c) =>
      c.id === id ? { ...c, title: trimmed } : c,
    );
    persist(conversations);
    set({ conversations });
  },

  remove: (id) => {
    const conversations = get().conversations.filter((c) => c.id !== id);
    persist(conversations);
    const activeId = get().activeId === id ? (conversations[0]?.id ?? null) : get().activeId;
    set({ conversations, activeId });
  },

  appendTurn: (conversationId, turn) => {
    const conversations = get().conversations.map((c) => {
      if (c.id !== conversationId) return c;
      const turns = [...c.turns, turn].slice(-MAX_TURNS_PER_CONVERSATION);
      const title =
        c.turns.length === 0 && turn.role === "user"
          ? turn.content.trim().slice(0, 48) || c.title
          : c.title;
      return { ...c, turns, title, updatedAt: Date.now() };
    });
    persist(conversations);
    set({ conversations });
  },

  patchTurn: (conversationId, turnId, patch) => {
    const conversations = get().conversations.map((c) => {
      if (c.id !== conversationId) return c;
      return {
        ...c,
        turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
        updatedAt: Date.now(),
      };
    });
    persist(conversations);
    set({ conversations });
  },

  setBusy: (busyConversationId) => set({ busyConversationId }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveJSON(SETTINGS_KEY, settings);
    set({ settings });
  },
}));
