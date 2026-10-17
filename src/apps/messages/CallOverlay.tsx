import { useEffect, useRef, useState } from "react";
import { Badge, Button, IconButton } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { callManager, type CallSnapshot } from "@/services/webrtc";
import { formatClockDuration } from "@/utils/format";

/* ==========================================================================
   Call overlay

   Shows the real state reported by the WebRTC manager and attaches the real
   remote stream to a media element. There is no simulated ringing: what you see
   is what the peer connection is doing.
   ========================================================================== */

export function CallOverlay({
  snapshot,
  onAccept,
  onEnd,
  onToggleMute,
  onToggleCamera,
}: {
  snapshot: CallSnapshot;
  onAccept: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(() => Date.now());

  // Advances the call timer while a call is connected.
  useEffect(() => {
    if (!snapshot.startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.startedAt]);

  // Remote media is attached whenever the manager reports a stream.
  useEffect(() => {
    const stream = callManager.getRemoteStream();
    if (!stream) return;
    if (audioRef.current && audioRef.current.srcObject !== stream) {
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => undefined);
    }
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [snapshot.state, snapshot.remoteAudio]);

  if (snapshot.state === "idle" || snapshot.state === "ended") return null;

  if (snapshot.state === "error") {
    return (
      <div className="cr-call cr-call--error" role="status">
        <Icon name="warning" size={15} />
        <span>{snapshot.error ?? "The call failed."}</span>
        <Button size="sm" variant="ghost" onClick={onEnd}>
          Dismiss
        </Button>
      </div>
    );
  }

  const isIncoming = snapshot.state === "incoming";
  const isVideo = snapshot.kind === "video";
  const duration = snapshot.startedAt ? (now - snapshot.startedAt) / 1000 : 0;

  return (
    <div className="cr-call" data-video={isVideo} role="dialog" aria-label="Call">
      <header className="cr-call__head">
        <Icon name={isVideo ? "video-cam" : "phone"} size={15} />
        <span className="cr-call__peer">{snapshot.peerName || "Unknown peer"}</span>
        <Badge
          tone={
            snapshot.state === "active"
              ? "success"
              : snapshot.state === "incoming"
                ? "accent"
                : "warning"
          }
        >
          {snapshot.state === "active"
            ? formatClockDuration(duration * 1000)
            : snapshot.state === "incoming"
              ? isVideo
                ? "Incoming video call"
                : "Incoming call"
              : snapshot.state}
        </Badge>
      </header>

      {isVideo && (
        <div className="cr-call__stage">
          <video ref={videoRef} className="cr-call__remote" playsInline autoPlay />
          {snapshot.state === "active" && !snapshot.remoteAudio && (
            <span className="cr-call__waiting">Waiting for the peer's video…</span>
          )}
        </div>
      )}
      <audio ref={audioRef} autoPlay />

      <footer className="cr-call__controls">
        {isIncoming ? (
          <>
            <Button variant="primary" icon="phone" onClick={onAccept}>
              Answer
            </Button>
            <Button variant="danger" icon="phone-off" onClick={onEnd}>
              Decline
            </Button>
          </>
        ) : (
          <>
            <IconButton
              icon={snapshot.muted ? "mic-off" : "mic"}
              label={snapshot.muted ? "Unmute" : "Mute"}
              active={snapshot.muted}
              onClick={onToggleMute}
            />
            {isVideo && (
              <IconButton
                icon={snapshot.cameraOff ? "video-cam" : "eye-off"}
                label={snapshot.cameraOff ? "Turn camera on" : "Turn camera off"}
                active={snapshot.cameraOff}
                onClick={onToggleCamera}
              />
            )}
            <Button variant="danger" icon="phone-off" onClick={onEnd}>
              Hang up
            </Button>
          </>
        )}
      </footer>

      {snapshot.state === "connecting" && (
        <p className="cr-call__hint">
          Negotiating with the peer. Public STUN is used for address discovery; networks that force a
          relay will not connect.
        </p>
      )}
    </div>
  );
}
