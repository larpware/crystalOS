import type { SignalPayload } from "./messaging";

/* ==========================================================================
   WebRTC call manager

   Real peer connections with real audio and video tracks. Signalling travels
   over the local mesh transport, so two CrystalOS sessions on the same
   origin can place genuine calls to each other. A relay (STUN/TURN and a
   WebSocket signalling server) is only required for peers on different
   machines; Settings → Messaging reports that boundary rather than hiding it.
   ========================================================================== */

/**
 * A public STUN server is enough to discover addresses for most direct
 * connections. TURN is deliberately not bundled: it needs credentials we
 * cannot ship in client code, so relay-dependent networks fall back to the
 * documented limitation instead of silently failing.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type CallKind = "audio" | "video";
export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended" | "error";

export interface CallSnapshot {
  state: CallState;
  kind: CallKind;
  peerId: string | null;
  peerName: string;
  startedAt: number | null;
  error: string | null;
  muted: boolean;
  cameraOff: boolean;
  /** True when remote audio has actually arrived. */
  remoteAudio: boolean;
}

export interface CallSignals {
  send: (to: string, payload: SignalPayload) => void;
}

type Listener = (snapshot: CallSnapshot) => void;

const initialSnapshot: CallSnapshot = {
  state: "idle",
  kind: "audio",
  peerId: null,
  peerName: "",
  startedAt: null,
  error: null,
  muted: false,
  cameraOff: false,
  remoteAudio: false,
};

class CallManager {
  private connection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private listeners = new Set<Listener>();
  private snapshot: CallSnapshot = { ...initialSnapshot };
  private callId = "";
  private signals: CallSignals | null = null;
  private pendingOffer: RTCSessionDescriptionInit | null = null;

  onSnapshot(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): CallSnapshot {
    return this.snapshot;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  private set(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  configured(signals: CallSignals): void {
    this.signals = signals;
  }

  private async capture(kind: CallKind): Promise<MediaStream | null> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.set({ state: "error", error: "This browser does not expose microphone or camera access." });
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === "video",
      });
      this.localStream = stream;
      return stream;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      const message =
        name === "NotAllowedError"
          ? "Microphone or camera permission was denied."
          : name === "NotFoundError"
            ? "No microphone or camera was found on this device."
            : "Could not open the microphone or camera.";
      this.set({ state: "error", error: message });
      return null;
    }
  }

  private createConnection(peerId: string): RTCPeerConnection {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signals?.send(peerId, {
          callId: this.callId,
          type: "candidate",
          data: event.candidate.toJSON(),
        });
      }
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.remoteStream = stream;
        const hasAudio = stream.getAudioTracks().length > 0;
        this.set({ remoteAudio: hasAudio });
      }
    };

    connection.onconnectionstatechange = () => {
      if (!this.connection) return;
      switch (this.connection.connectionState) {
        case "connected":
          this.set({
            state: "active",
            startedAt: this.snapshot.startedAt ?? Date.now(),
            error: null,
          });
          break;
        case "failed":
          this.set({ state: "error", error: "The connection could not be established." });
          break;
        case "disconnected":
          this.set({ state: "connecting" });
          break;
        case "closed":
          this.cleanup();
          break;
        default:
          break;
      }
    };

    return connection;
  }

  async start(kind: CallKind, peerId: string, peerName: string): Promise<void> {
    if (!this.signals) {
      this.set({ state: "error", error: "Signalling transport is unavailable." });
      return;
    }
    await this.hangup(true);
    this.callId = `call_${Date.now().toString(36)}`;
    this.set({ state: "outgoing", kind, peerId, peerName, error: null });

    const stream = await this.capture(kind);
    if (!stream) return;

    this.connection = this.createConnection(peerId);
    for (const track of stream.getTracks()) this.connection.addTrack(track, stream);

    try {
      const offer = await this.connection.createOffer();
      await this.connection.setLocalDescription(offer);
      this.signals.send(peerId, { callId: this.callId, type: "offer", data: offer });
      this.set({ state: "connecting" });
    } catch {
      this.set({ state: "error", error: "Could not create the call offer." });
    }
  }

  /** Handles an inbound signalling envelope. */
  async handleSignal(fromId: string, payload: SignalPayload): Promise<void> {
    if (!this.signals) return;

    if (payload.type === "offer") {
      // Busy on another call — decline rather than silently replacing it.
      if (this.snapshot.state === "active" || this.snapshot.state === "connecting") {
        this.signals.send(fromId, { callId: payload.callId, type: "reject", data: null });
        return;
      }
      this.pendingOffer = payload.data as RTCSessionDescriptionInit;
      this.callId = payload.callId;
      this.set({
        state: "incoming",
        peerId: fromId,
        kind: this.pendingOffer.sdp?.includes("m=video") ? "video" : "audio",
        error: null,
      });
      return;
    }

    if (payload.type === "reject") {
      this.set({ state: "ended", error: "The call was declined." });
      await this.hangup(true);
      this.set({ state: "idle", error: "The call was declined." });
      return;
    }

    if (payload.type === "hangup") {
      await this.hangup(true);
      return;
    }

    if (!this.connection) {
      if (payload.type === "candidate") {
        this.candidateQueue.push(payload.data as RTCIceCandidateInit);
      }
      return;
    }

    try {
      if (payload.type === "answer") {
        await this.connection.setRemoteDescription(
          new RTCSessionDescription(payload.data as RTCSessionDescriptionInit),
        );
        for (const candidate of this.candidateQueue.splice(0)) {
          await this.connection.addIceCandidate(candidate);
        }
        this.set({ state: "connecting" });
      } else if (payload.type === "candidate") {
        await this.connection.addIceCandidate(new RTCIceCandidate(payload.data as RTCIceCandidateInit));
      }
    } catch {
      this.set({ state: "error", error: "Signalling failed mid-call." });
    }
  }

  /** Accepts the pending incoming call. */
  async accept(): Promise<void> {
    if (!this.pendingOffer || !this.snapshot.peerId) return;
    const peerId = this.snapshot.peerId;
    const kind = this.snapshot.kind;
    this.set({ state: "connecting" });

    const stream = await this.capture(kind);
    if (!stream) return;

    this.connection = this.createConnection(peerId);
    for (const track of stream.getTracks()) this.connection.addTrack(track, stream);

    try {
      await this.connection.setRemoteDescription(new RTCSessionDescription(this.pendingOffer));
      for (const candidate of this.candidateQueue.splice(0)) {
        await this.connection.addIceCandidate(candidate);
      }
      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);
      this.signals?.send(peerId, { callId: this.callId, type: "answer", data: answer });
      this.pendingOffer = null;
      this.set({ startedAt: Date.now() });
    } catch {
      this.set({ state: "error", error: "Could not answer the call." });
    }
  }

  toggleMute(): void {
    const stream = this.localStream;
    if (!stream) return;
    const muted = !this.snapshot.muted;
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
    this.set({ muted });
  }

  toggleCamera(): void {
    const stream = this.localStream;
    if (!stream) return;
    const cameraOff = !this.snapshot.cameraOff;
    for (const track of stream.getVideoTracks()) track.enabled = !cameraOff;
    this.set({ cameraOff });
  }

  async hangup(silent = false): Promise<void> {
    const peerId = this.snapshot.peerId;
    if (!silent && peerId) {
      this.signals?.send(peerId, { callId: this.callId, type: "hangup", data: null });
    }
    this.cleanup();
    this.set({ state: "idle" });
  }

  private cleanup(): void {
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.remoteStream = null;
    this.candidateQueue = [];
    this.pendingOffer = null;
    if (this.connection) {
      this.connection.onconnectionstatechange = null;
      this.connection.onicecandidate = null;
      this.connection.ontrack = null;
      this.connection.close();
      this.connection = null;
    }
    this.set({ peerId: null, peerName: "", startedAt: null, muted: false, cameraOff: false, remoteAudio: false });
  }
}

export const callManager = new CallManager();
