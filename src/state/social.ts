import { create } from "zustand";
import * as social from "@/services/social";
import type { FriendSummary, IncomingFriendRequest, OutgoingFriendRequest } from "@/types";
import { useChatStore } from "./chat";

/* ==========================================================================
   Friends state

   The friends list, the request queues and the friend-code search all come from
   the account server. This store is a read-mostly cache on top of it plus one
   poll loop, because the server does not push: every few seconds it asks for
   everything that changed since the last answer.

   Nothing here is persisted. Refreshing the page rebuilds the whole picture
   from the server, which is what makes "sign out, close the tab, come back"
   behave the way people expect.
   ========================================================================== */

type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

/** How often the client asks the server for changes. */
const POLL_INTERVAL_MS = 4_000;

/**
 * The watermark for `since`. It lives outside the store because it is
 * transport bookkeeping, not UI state, and it must survive re-renders.
 */
let cursor = 0;
let timer: ReturnType<typeof setInterval> | null = null;

interface SocialState {
  status: ConnectionStatus;
  friends: FriendSummary[];
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
  /** Set by the last failed poll or action; cleared by the next success. */
  error: string | null;
  /** The friend-request code field's in-flight state. */
  busy: boolean;
  lastSyncedAt: number;

  start: () => void;
  stop: () => void;
  /** Pulls a snapshot now; used after an action so the UI updates at once. */
  refresh: () => Promise<void>;
  addFriendByCode: (code: string) => Promise<{ ok: boolean; message: string }>;
  accept: (requestId: string) => Promise<{ ok: boolean; message: string }>;
  decline: (requestId: string) => Promise<{ ok: boolean; message: string }>;
  cancel: (requestId: string) => Promise<{ ok: boolean; message: string }>;
  removeFriend: (userId: string) => Promise<{ ok: boolean; message: string }>;
  clearError: () => void;
}

function toPeerRef(friend: FriendSummary) {
  return {
    id: friend.id,
    username: friend.username,
    displayName: friend.displayName,
    friendCode: friend.friendCode,
    avatar: friend.avatar,
    tags: friend.tags,
  };
}

export const useSocialStore = create<SocialState>()((set, get) => ({
  status: "idle",
  friends: [],
  incoming: [],
  outgoing: [],
  error: null,
  busy: false,
  lastSyncedAt: 0,

  start: () => {
    // The watermark starts slightly in the past so a message that arrived
    // between page load and the first poll is not skipped. Duplicates are
    // impossible anyway — every message carries its server id.
    cursor = Date.now() - 2_000;
    set({ status: "connecting", error: null });
    void get().refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(() => void get().refresh(), POLL_INTERVAL_MS);
  },

  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    cursor = 0;
    set({ status: "idle", friends: [], incoming: [], outgoing: [], error: null });
    useChatStore.getState().setFriends([]);
  },

  refresh: async () => {
    const result = await social.sync(cursor);
    if (!result.ok) {
      set({ status: "offline", error: result.error.message });
      return;
    }
    const snapshot = result.data;
    cursor = Math.max(cursor, snapshot.serverTime);
    set({
      status: "online",
      friends: snapshot.friends,
      incoming: snapshot.incoming,
      outgoing: snapshot.outgoing,
      error: null,
      lastSyncedAt: Date.now(),
    });

    // Keep the chat app's friend list and open conversations in step.
    const chat = useChatStore.getState();
    chat.setFriends(snapshot.friends.map(toPeerRef));
    for (const entry of snapshot.messages) {
      if (!entry.peer) continue;
      chat.receiveServerMessage(toPeerRef(entry.peer), entry.message);
    }
  },

  addFriendByCode: async (code) => {
    set({ busy: true, error: null });
    const result = await social.requestFriend(code);
    set({ busy: false });
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, message: result.error.message };
    }
    await get().refresh();
    return { ok: true, message: `Request sent to ${result.data.request.to.displayName}.` };
  },

  accept: async (requestId) => {
    const result = await social.acceptFriendRequest(requestId);
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, message: result.error.message };
    }
    await get().refresh();
    return { ok: true, message: `${result.data.friend.displayName} is now on your friends list.` };
  },

  decline: async (requestId) => {
    const result = await social.declineFriendRequest(requestId);
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, message: result.error.message };
    }
    await get().refresh();
    return { ok: true, message: "Request declined." };
  },

  cancel: async (requestId) => {
    const result = await social.cancelFriendRequest(requestId);
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, message: result.error.message };
    }
    await get().refresh();
    return { ok: true, message: "Request cancelled." };
  },

  removeFriend: async (userId) => {
    const result = await social.removeFriend(userId);
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, message: result.error.message };
    }
    await get().refresh();
    return { ok: true, message: "Friend removed." };
  },

  clearError: () => set({ error: null }),
}));
