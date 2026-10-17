import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import {
  mesh,
  peerRefFromProfile,
  type Envelope,
  type MeshMessagePayload,
  type PeerRef,
  type PeerState,
  type SignalPayload,
} from "@/services/messaging";
import { callManager, type CallKind, type CallSnapshot } from "@/services/webrtc";
import * as social from "@/services/social";
import type {
  AccountProfile,
  Channel,
  ChatMessage,
  ChatServer,
  DirectChannel,
  ServerMessage,
} from "@/types";
import { createId, stripControlCharacters } from "@/utils/format";

type TransportStatus = "offline" | "local";

interface ChatState {
  channels: Channel[];
  messages: Record<string, ChatMessage[]>;
  /**
   * The signed-in account's friends, kept current by the social store from the
   * account server. Cached here because the rest of the app (groups, member
   * lists, direct channels) already speaks this shape.
   */
  friends: PeerRef[];
  servers: ChatServer[];
  activeChannelId: string | null;
  typing: Record<string, { peerId: string; name: string; at: number }[]>;
  peers: PeerState[];
  transport: TransportStatus;
  selfId: string | null;
  /** Identity broadcast to other sessions. */
  self: PeerRef | null;
  call: CallSnapshot;
  /**
   * True for registered accounts: direct messages go to the account server so
   * they reach the other person on any machine. Guest sessions only ever see
   * the local mesh.
   */
  serverRelay: boolean;
  /**
   * Which account the local channels and message cache belong to. Several
   * accounts can share one browser, and a conversation is private to the two
   * people in it, so signing in as someone else drops the previous account's
   * local cache instead of showing them channels that are not theirs.
   */
  ownerId: string | null;

  attach: (profile: AccountProfile) => void;
  detach: () => void;

  createDirectChannel: (peer: PeerRef) => string;
  /** Replaces the cached friends list (server-synced, never a source of truth). */
  setFriends: (friends: PeerRef[]) => void;
  /** Pulls a direct conversation's history from the server. */
  loadServerHistory: (channelId: string, peerId: string) => Promise<void>;
  /** Appends a message delivered by the account server. */
  receiveServerMessage: (peer: PeerRef, message: ServerMessage) => void;
  createGroup: (name: string, members: PeerRef[]) => string;
  renameGroup: (channelId: string, name: string) => void;
  leaveChannel: (channelId: string) => void;

  createServer: (name: string) => string;
  createServerChannel: (serverId: string, name: string) => string | null;
  renameServerChannel: (serverId: string, channelId: string, name: string) => void;
  /** Asks a connected session to share its servers. */
  requestServersFrom: (peerId: string) => { ok: boolean; message: string };
  leaveServer: (serverId: string) => void;
  deleteServer: (serverId: string) => void;

  sendMessage: (channelId: string, body: string) => void;
  setActiveChannel: (channelId: string | null) => void;

  signalTyping: (channelId: string) => void;

  startCall: (kind: CallKind, peerId: string, peerName: string) => void;
  acceptCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;

  reset: () => void;
}

/** Deterministic id so both participants agree on the same direct channel. */
function directChannelId(a: string, b: string): string {
  return `dm_${[a, b].sort().join("__")}`;
}

function sanitize(value: string, max = 2000): string {
  return stripControlCharacters(value).slice(0, max).trim();
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      channels: [],
      messages: {},
      friends: [],
      servers: [],
      activeChannelId: null,
      typing: {},
      peers: [],
      transport: "offline",
      selfId: null,
      self: null,
      call: callManager.getSnapshot(),
      serverRelay: false,
      ownerId: null,

      attach: (profile) => {
        const self = peerRefFromProfile(profile);
        // A different account signing in must not inherit this account's
        // channels. Registered accounts rebuild their conversations from the
        // server; guests start empty.
        if (get().ownerId && get().ownerId !== profile.id) {
          set({
            channels: [],
            messages: {},
            servers: [],
            activeChannelId: null,
            typing: {},
            friends: [],
          });
        }
        set({
          ownerId: profile.id,
          selfId: profile.id,
          self,
          // Registered accounts talk to the account server; guests do not. The
          // mesh still runs for both — it is what connects two sessions in
          // this browser instantly.
          serverRelay: !profile.guest,
          transport: mesh.available ? "local" : "offline",
        });

        callManager.configured({
          send: (to, payload) => mesh.send("signal", to, payload),
        });

        mesh.onPeers((peers) => set({ peers }));

        mesh.onMessage((envelope) => handleEnvelope(envelope, get, set));

        mesh.start(self);

        const unsubscribeCall = callManager.onSnapshot((snapshot) => set({ call: snapshot }));

        const heartbeat = window.setInterval(() => {
          const cutoff = Date.now() - 4500;
          const typing = { ...get().typing };
          let changed = false;
          for (const channelId of Object.keys(typing)) {
            const remaining = typing[channelId].filter((entry) => entry.at > cutoff);
            if (remaining.length !== typing[channelId].length) {
              typing[channelId] = remaining;
              changed = true;
            }
          }
          if (changed) set({ typing });
        }, 1500);

        detachRefs = () => {
          unsubscribeCall();
          window.clearInterval(heartbeat);
        };
      },

      detach: () => {
        detachRefs?.();
        detachRefs = null;
        mesh.stop();
        set({
          peers: [],
          transport: "offline",
          selfId: null,
          self: null,
          serverRelay: false,
        });
      },

      createDirectChannel: (peer) => {
        const selfId = get().selfId;
        if (!selfId) return "";
        const id = directChannelId(selfId, peer.id);
        if (!get().channels.some((channel) => channel.id === id)) {
          const channel: DirectChannel = {
            id,
            kind: "direct",
            peerId: peer.id,
            peerName: peer.displayName,
            peerCode: peer.friendCode,
          };
          set({ channels: [...get().channels, channel] });
        }
        set({ activeChannelId: id });
        // Opening a friend's conversation pulls its history from the server, so
        // what they wrote while this tab was closed is there.
        if (get().serverRelay) void get().loadServerHistory(id, peer.id);
        return id;
      },

      setFriends: (friends) => {
        const current = get().friends;
        const unchanged =
          current.length === friends.length &&
          current.every(
            (friend, index) =>
              friend.id === friends[index].id &&
              friend.displayName === friends[index].displayName &&
              friend.avatar === friends[index].avatar,
          );
        if (!unchanged) set({ friends });
      },

      loadServerHistory: async (channelId, peerId) => {
        const result = await social.loadConversation(peerId);
        if (!result.ok) return;
        const fromServer: ChatMessage[] = result.data.messages.map((message) => ({
          id: message.id,
          channelId,
          authorId: message.authorId,
          authorName: message.authorName,
          body: message.body,
          sentAt: message.sentAt,
        }));
        const state = get();
        const existing = state.messages[channelId] ?? [];
        const known = new Set(existing.map((message) => message.id));
        const merged = [...existing, ...fromServer.filter((message) => !known.has(message.id))].sort(
          (a, b) => a.sentAt - b.sentAt,
        );
        if (merged.length === existing.length) return;
        set({ messages: { ...state.messages, [channelId]: merged } });
      },

      receiveServerMessage: (peer, message) => {
        const selfId = get().selfId;
        if (!selfId) return;
        const channelId = directChannelId(selfId, peer.id);
        if (!get().channels.some((channel) => channel.id === channelId)) {
          const channel: DirectChannel = {
            id: channelId,
            kind: "direct",
            peerId: peer.id,
            peerName: peer.displayName,
            peerCode: peer.friendCode,
          };
          set({ channels: [...get().channels, channel] });
        }
        const existing = get().messages[channelId] ?? [];
        if (existing.some((entry) => entry.id === message.id)) return;
        const entry: ChatMessage = {
          id: message.id,
          channelId,
          authorId: message.authorId,
          authorName: message.authorName,
          body: sanitize(message.body),
          sentAt: message.sentAt,
        };
        set({ messages: { ...get().messages, [channelId]: [...existing, entry] } });
        if (get().activeChannelId !== channelId) {
          void import("./notifications").then(({ useNotificationStore }) => {
            useNotificationStore.getState().notify({
              appId: "messages",
              icon: "messages",
              title: peer.displayName,
              body: entry.body.slice(0, 120),
            });
          });
        }
      },

      createGroup: (name, members) => {
        const id = createId("grp");
        mesh.send("server-invite", null, {
          channel: {
            id,
            kind: "group",
            name: sanitize(name, 40) || "New group",
            memberIds: members.map((member) => member.id),
          },
        });
        set({
          channels: [
            ...get().channels,
            {
              id,
              kind: "group",
              name: sanitize(name, 40) || "New group",
              memberIds: members.map((member) => member.id),
            },
          ],
          activeChannelId: id,
        });
        return id;
      },

      renameGroup: (channelId, name) =>
        set({
          channels: get().channels.map((channel) =>
            channel.id === channelId && channel.kind !== "direct"
              ? { ...channel, name: sanitize(name, 40) }
              : channel,
          ),
        }),

      leaveChannel: (channelId) =>
        set({
          channels: get().channels.filter((channel) => channel.id !== channelId),
          activeChannelId: get().activeChannelId === channelId ? null : get().activeChannelId,
        }),

      createServer: (name) => {
        const id = createId("srv");
        const general = createId("chn");
        const server: ChatServer = {
          id,
          name: sanitize(name, 40) || "New server",
          ownerId: get().selfId ?? "local",
          memberIds: get().selfId ? [get().selfId as string] : [],
          channels: [{ id: general, name: "general" }],
        };
        set({
          servers: [...get().servers, server],
          channels: [
            ...get().channels,
            { id: general, kind: "server", serverId: id, name: "general" },
          ],
          activeChannelId: general,
        });
        return id;
      },

      createServerChannel: (serverId, name) => {
        const server = get().servers.find((candidate) => candidate.id === serverId);
        if (!server) return null;
        const id = createId("chn");
        const channelName = (sanitize(name, 32) || "channel").toLowerCase().replace(/\s+/g, "-");
        set({
          servers: get().servers.map((candidate) =>
            candidate.id === serverId
              ? { ...candidate, channels: [...candidate.channels, { id, name: channelName }] }
              : candidate,
          ),
          channels: [
            ...get().channels,
            { id, kind: "server", serverId, name: channelName },
          ],
          activeChannelId: id,
        });
        return id;
      },

      renameServerChannel: (serverId, channelId, name) => {
        const channelName = (sanitize(name, 32) || "channel").toLowerCase().replace(/\s+/g, "-");
        set({
          servers: get().servers.map((server) =>
            server.id === serverId
              ? {
                  ...server,
                  channels: server.channels.map((channel) =>
                    channel.id === channelId ? { ...channel, name: channelName } : channel,
                  ),
                }
              : server,
          ),
          channels: get().channels.map((channel) =>
            channel.id === channelId ? { ...channel, name: channelName } : channel,
          ),
        });
      },

      requestServersFrom: (peerId) => {
        const peer = get().peers.find((state) => state.peer.id === peerId);
        if (!peer) return { ok: false, message: "That session is not reachable right now." };
        mesh.send("server-invite", peerId, { request: true });
        return { ok: true, message: `Asked ${peer.peer.displayName} to share their servers.` };
      },

      leaveServer: (serverId) => {
        const orphans = get()
          .channels.filter((channel) => channel.kind === "server" && channel.serverId === serverId)
          .map((channel) => channel.id);
        set({
          servers: get().servers.filter((server) => server.id !== serverId),
          channels: get().channels.filter((channel) => !orphans.includes(channel.id)),
          activeChannelId: orphans.includes(get().activeChannelId ?? "")
            ? null
            : get().activeChannelId,
        });
      },

      deleteServer: (serverId) => get().leaveServer(serverId),

      sendMessage: (channelId, body) => {
        const text = sanitize(body);
        const selfId = get().selfId;
        if (!text || !selfId) return;
        const message: ChatMessage = {
          id: createId("msg"),
          channelId,
          authorId: selfId,
          authorName: "",
          body: text,
          sentAt: Date.now(),
        };
        const existing = get().messages[channelId] ?? [];
        set({
          messages: { ...get().messages, [channelId]: [...existing, message] },
        });
        const payload: MeshMessagePayload = {
          channelId,
          body: text,
          messageId: message.id,
        };

        const channel = get().channels.find((entry) => entry.id === channelId);
        // Registered accounts deliver through the account server, which is the
        // only path that reaches another machine. The message keeps the id the
        // server stores, so an echo can never duplicate it.
        if (channel?.kind === "direct" && get().serverRelay) {
          void social.sendDirectMessage(channel.peerId, text, message.id).then((result) => {
            // Not friends (or the server is unreachable): fall back to the mesh
            // so two sessions in this browser still exchange the message.
            if (!result.ok) mesh.send("message", null, payload);
          });
          return;
        }
        mesh.send("message", null, payload);
      },

      setActiveChannel: (activeChannelId) => set({ activeChannelId }),

      signalTyping: (channelId) => {
        mesh.send("typing", null, { channelId });
      },

      startCall: (kind, peerId, peerName) => {
        void callManager.start(kind, peerId, peerName);
      },
      acceptCall: () => void callManager.accept(),
      endCall: () => void callManager.hangup(),
      toggleMute: () => callManager.toggleMute(),
      toggleCamera: () => callManager.toggleCamera(),

      reset: () =>
        set({
          channels: [],
          messages: {},
          servers: [],
          activeChannelId: null,
          typing: {},
        }),
    }),
    {
      name: "chat",
      version: 2,
      storage: jsonStorageFor<ChatState>(),
      // Friends and requests are not persisted: they belong to the account
      // server and are rebuilt from it on every launch. Channels, the message
      // cache and servers stay local so history survives a refresh.
      migrate: (persisted, version) => {
        const state = persisted as Partial<ChatState> | undefined;
        if (version < 2) {
          const legacy = state as Record<string, unknown> | undefined;
          delete legacy?.friends;
          delete legacy?.requests;
          delete legacy?.outgoing;
        }
        return state as ChatState;
      },
      partialize: (state) =>
        ({
          ownerId: state.ownerId,
          channels: state.channels,
          messages: state.messages,
          servers: state.servers,
          activeChannelId: state.activeChannelId,
        }) as ChatState,
    },
  ),
);

let detachRefs: (() => void) | null = null;

function handleEnvelope(
  envelope: Envelope,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
): void {
  const state = get();

  switch (envelope.kind) {
    case "message": {
      const payload = envelope.payload as MeshMessagePayload | undefined;
      if (!payload) return;
      const known = state.channels.some((channel) => channel.id === payload.channelId);
      const isDirectWithMe = state.selfId
        ? payload.channelId === directChannelId(state.selfId, envelope.from.id)
        : false;
      if (!known && !isDirectWithMe) return;

      if (!known && isDirectWithMe && state.selfId) {
        const channel: DirectChannel = {
          id: payload.channelId,
          kind: "direct",
          peerId: envelope.from.id,
          peerName: envelope.from.displayName,
          peerCode: envelope.from.friendCode,
        };
        set({ channels: [...state.channels, channel] });
      }

      const existing = state.messages[payload.channelId] ?? [];
      if (existing.some((message) => message.id === payload.messageId)) return;
      const message: ChatMessage = {
        id: payload.messageId,
        channelId: payload.channelId,
        authorId: envelope.from.id,
        authorName: envelope.from.displayName,
        body: sanitize(payload.body),
        sentAt: envelope.at,
      };
      set({
        messages: { ...state.messages, [payload.channelId]: [...existing, message] },
      });

      if (state.activeChannelId !== payload.channelId) {
        void import("./notifications").then(({ useNotificationStore }) => {
          useNotificationStore.getState().notify({
            appId: "messages",
            icon: "messages",
            title: envelope.from.displayName,
            body: message.body.slice(0, 120),
          });
        });
      }
      break;
    }

    case "typing": {
      const payload = envelope.payload as { channelId?: string } | undefined;
      if (!payload?.channelId) return;
      const list = state.typing[payload.channelId] ?? [];
      const next = list.filter((entry) => entry.peerId !== envelope.from.id);
      next.push({ peerId: envelope.from.id, name: envelope.from.displayName, at: Date.now() });
      set({ typing: { ...state.typing, [payload.channelId]: next } });
      break;
    }

    case "signal": {
      void callManager.handleSignal(envelope.from.id, envelope.payload as SignalPayload);
      break;
    }

    case "server-invite": {
      const payload = envelope.payload as
        | { channel?: Channel; server?: ChatServer; servers?: ChatServer[]; request?: boolean }
        | undefined;
      if (!payload) return;

      // A friend asked to see our servers — share the ones we own with them.
      if (payload.request) {
        if (!state.friends.some((friend) => friend.id === envelope.from.id)) return;
        const owned = state.servers.filter((server) => server.ownerId === state.selfId);
        if (owned.length === 0) return;
        mesh.send("server-invite", envelope.from.id, { servers: owned });
        return;
      }

      if (payload.channel) {
        const channel = payload.channel;
        if (state.channels.some((candidate) => candidate.id === channel.id)) return;
        set({ channels: [...state.channels, channel] });
      }

      const incoming = [...(payload.servers ?? []), ...(payload.server ? [payload.server] : [])];
      if (incoming.length === 0) return;
      const accepted = incoming.filter(
        (server) => !state.servers.some((candidate) => candidate.id === server.id),
      );
      if (accepted.length === 0) return;
      set({
        servers: [...state.servers, ...accepted],
        channels: [...state.channels, ...accepted.flatMap(channelsFromServer)],
      });
      void import("./notifications").then(({ useNotificationStore }) => {
        useNotificationStore.getState().notify({
          appId: "messages",
          icon: "hash",
          title: "Servers added",
          body: `${envelope.from.displayName} shared ${accepted.length} server${accepted.length === 1 ? "" : "s"}.`,
        });
      });
      break;
    }

    default:
      break;
  }
}

export function channelsFromServer(server: ChatServer): Channel[] {
  return server.channels.map((channel) => ({
    id: channel.id,
    kind: "server" as const,
    serverId: server.id,
    name: channel.name,
  }));
}

export function channelsOfKind(channels: Channel[], kind: Channel["kind"]): Channel[] {
  return channels.filter((channel) => channel.kind === kind);
}

export { directChannelId };
