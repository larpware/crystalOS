import type { AccountProfile } from "@/types";

/* ==========================================================================
   CrystalOS messaging transport

   Messages are delivered over a BroadcastChannel, which is a real transport:
   open CrystalOS in two tabs and the two sessions genuinely exchange
   messages, presence and WebRTC signalling in real time.

   What this transport is NOT is a relay. BroadcastChannel only reaches
   same-origin browsing contexts, so two different machines cannot see each
   other. Settings → Messaging states this, and the store surfaces the
   transport status instead of pretending to be connected to the internet.
   Swapping in a WebSocket relay means implementing the same `MeshTransport`
   interface — no application code changes.
   ========================================================================== */

export interface PeerRef {
  id: string;
  username: string;
  displayName: string;
  friendCode: string;
  avatar?: string;
}

export type EnvelopeKind =
  | "hello"
  | "heartbeat"
  | "bye"
  | "message"
  | "typing"
  | "presence"
  | "friend-request"
  | "friend-accept"
  | "server-invite"
  | "signal";

export interface Envelope {
  kind: EnvelopeKind;
  from: PeerRef;
  to?: string | null;
  at: number;
  payload?: unknown;
}

export interface PeerState {
  peer: PeerRef;
  lastSeen: number;
  status: "online" | "idle" | "offline";
}

type Handler = (envelope: Envelope) => void;

const CHANNEL_NAME = "crystalos-mesh";
const HEARTBEAT_MS = 5_000;
const OFFLINE_AFTER_MS = 14_000;

/** Message payload delivered between two sessions. */
export interface MeshMessagePayload {
  channelId: string;
  body: string;
  messageId: string;
}

export interface SignalPayload {
  callId: string;
  /** `offer`, `answer` or a serialised ICE candidate. */
  type: "offer" | "answer" | "candidate" | "hangup" | "reject";
  data: unknown;
}

class MeshTransport {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<Handler>();
  private self: PeerRef | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private peers = new Map<string, PeerState>();
  private peerListeners = new Set<(peers: PeerState[]) => void>();
  private started = false;
  /** Distinguishes two sessions signed in as the same account. */
  readonly sessionId = Math.random().toString(36).slice(2, 10);

  get available(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  start(self: PeerRef): void {
    this.self = self;
    if (this.started) {
      this.broadcast("hello");
      return;
    }
    this.started = true;

    if (this.available) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<Envelope>) => {
        this.receive(event.data);
      };
    }

    this.heartbeat = setInterval(() => {
      this.broadcast("heartbeat");
      this.prunePeers();
    }, HEARTBEAT_MS);

    this.broadcast("hello");
  }

  updateSelf(self: PeerRef): void {
    this.self = self;
    this.broadcast("hello");
  }

  stop(): void {
    if (!this.started) return;
    this.broadcast("bye");
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.channel?.close();
    this.channel = null;
    this.started = false;
    this.peers.clear();
    this.emitPeers();
  }

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onPeers(listener: (peers: PeerState[]) => void): () => void {
    this.peerListeners.add(listener);
    listener(this.peerList());
    return () => this.peerListeners.delete(listener);
  }

  send(kind: EnvelopeKind, to: string | null, payload?: unknown): void {
    if (!this.self) return;
    this.post({ kind, from: this.self, to, at: Date.now(), payload });
  }

  peerList(): PeerState[] {
    return Array.from(this.peers.values()).sort((a, b) => a.peer.displayName.localeCompare(b.peer.displayName));
  }

  private broadcast(kind: EnvelopeKind, payload?: unknown): void {
    this.send(kind, null, payload);
  }

  private post(envelope: Envelope): void {
    try {
      this.channel?.postMessage(envelope);
    } catch {
      /* channel closed mid-flight */
    }
  }

  private receive(envelope: Envelope): void {
    if (!envelope || envelope.from?.id === this.self?.id) return;
    if (envelope.to && envelope.to !== this.self?.id) return;

    if (envelope.kind === "bye") {
      this.peers.delete(envelope.from.id);
      this.emitPeers();
    } else {
      const existing = this.peers.get(envelope.from.id);
      this.peers.set(envelope.from.id, {
        peer: envelope.from,
        lastSeen: Date.now(),
        status: existing?.status ?? "online",
      });
      this.emitPeers();
      // Answer a hello so both sides learn about each other immediately.
      if (envelope.kind === "hello" && this.self) {
        this.post({
          kind: "heartbeat",
          from: this.self,
          to: null,
          at: Date.now(),
        });
      }
    }

    if (envelope.kind === "hello" || envelope.kind === "heartbeat" || envelope.kind === "bye") {
      return;
    }
    for (const handler of this.handlers) handler(envelope);
  }

  private prunePeers(): void {
    const cutoff = Date.now() - OFFLINE_AFTER_MS;
    let changed = false;
    for (const [id, state] of this.peers) {
      if (state.lastSeen < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private emitPeers(): void {
    const list = this.peerList();
    for (const listener of this.peerListeners) listener(list);
  }
}

export const mesh = new MeshTransport();

export function peerRefFromProfile(profile: AccountProfile): PeerRef {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    // Guests have no server-assigned friend code; the mesh identity carries an
    // empty one rather than inventing a code the server would never accept.
    friendCode: profile.friendCode ?? "",
    avatar: profile.avatar,
  };
}
