import { usePlaybackStore } from "@/state/playback";

/* ==========================================================================
   Audio service

   One AudioContext with a single master gain. Everything the OS plays — the
   Music player, the Media player, generated sessions — is routed through it,
   so the volume control in Quick Settings and Settings → Power governs real
   output rather than a number that nothing reads.

   The context is created lazily: browsers refuse to start audio before a user
   gesture, so `resume()` is called from the first play action.
   ========================================================================== */

let context: AudioContext | null = null;
let master: GainNode | null = null;
let attached = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
let unsubscribe: (() => void) | null = null;

function ensure(): { context: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (context && master) return { context, master };

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    context = new Ctor();
  } catch {
    return null;
  }

  master = context.createGain();
  const { volume, muted } = usePlaybackStore.getState();
  master.gain.value = muted ? 0 : volume;
  master.connect(context.destination);

  unsubscribe?.();
  unsubscribe = usePlaybackStore.subscribe((state) => {
    if (!master || !context) return;
    const target = state.muted ? 0 : state.volume;
    // A short ramp avoids the click a hard gain jump produces.
    master.gain.setTargetAtTime(target, context.currentTime, 0.02);
  });

  return { context, master };
}

export function audioAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
  );
}

export function audioContext(): AudioContext | null {
  return ensure()?.context ?? null;
}

export async function resumeAudio(): Promise<boolean> {
  const graph = ensure();
  if (!graph) return false;
  if (graph.context.state === "suspended") {
    try {
      await graph.context.resume();
    } catch {
      return false;
    }
  }
  return graph.context.state === "running";
}

/** Routes a media element through the master gain so volume applies to it. */
export function attachMedia(element: HTMLMediaElement): void {
  const graph = ensure();
  if (!graph || attached.has(element)) return;
  try {
    const source = graph.context.createMediaElementSource(element);
    source.connect(graph.master);
    attached.set(element, source);
  } catch {
    // A cross-origin or already-routed element cannot be captured. Leaving it
    // unconnected keeps it audible through the default path, which is better
    // than silencing it.
  }
}

export function detachMedia(element: HTMLMediaElement): void {
  const source = attached.get(element);
  if (!source) return;
  try {
    source.disconnect();
  } catch {
    /* already disconnected */
  }
  attached.delete(element);
}

export function audioState(): { available: boolean; state: string } {
  const graph = ensure();
  return { available: Boolean(graph), state: graph?.context.state ?? "unavailable" };
}

/* ==========================================================================
   Generated sessions

   These are synthesised on this device with oscillators and filters — there is
   no recording behind them, and the UI says so. Each session describes its own
   structure so the player can show a real duration and a real progress bar.
   ========================================================================== */

export interface SessionVoice {
  /** Root note in Hz. */
  root: number;
  /** Interval ratios layered over the root. */
  ratios: number[];
  /** Filter cutoff in Hz. */
  cutoff: number;
  /** Beats per minute for the slow amplitude movement. */
  pulse: number;
}

export interface GeneratedSession {
  id: string;
  title: string;
  mood: string;
  durationSeconds: number;
  voice: SessionVoice;
  description: string;
}

export const generatedSessions: GeneratedSession[] = [
  {
    id: "session-ridge",
    title: "Ridge",
    mood: "Ambient",
    durationSeconds: 214,
    voice: { root: 110, ratios: [1, 1.5, 2, 2.5], cutoff: 900, pulse: 26 },
    description:
      "Four sine partials over a slow filter sweep. Generated at playback time, nothing is downloaded.",
  },
  {
    id: "session-lowtide",
    title: "Low Tide",
    mood: "Ambient",
    durationSeconds: 268,
    voice: { root: 82.4, ratios: [1, 1.335, 2, 3], cutoff: 620, pulse: 20 },
    description: "A darker voicing with a wider partial spread and a slower amplitude pulse.",
  },
  {
    id: "session-lattice",
    title: "Lattice",
    mood: "Drone",
    durationSeconds: 180,
    voice: { root: 146.8, ratios: [1, 1.25, 1.5, 2, 4], cutoff: 1400, pulse: 34 },
    description: "Higher partials with a brighter filter, closest to a drone than a chord.",
  },
  {
    id: "session-nightwalk",
    title: "Night Walk",
    mood: "Ambient",
    durationSeconds: 302,
    voice: { root: 98, ratios: [1, 1.2, 1.8, 2.4, 3.6], cutoff: 760, pulse: 24 },
    description: "The longest session, tuned for low, even movement across five partials.",
  },
];

export interface SessionHandle {
  stop: () => void;
  duration: number;
}

/**
 * Plays a generated session. Returns a handle whose `stop` releases every node
 * it created — the caller owns the lifetime.
 */
export async function playSession(session: GeneratedSession): Promise<SessionHandle | null> {
  const graph = ensure();
  if (!graph) return null;
  const running = await resumeAudio();
  if (!running) return null;

  const { context: ctx, master: out } = graph;
  const now = ctx.currentTime;
  const duration = session.durationSeconds;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = session.voice.cutoff;
  filter.Q.value = 0.6;

  const shaper = ctx.createGain();
  shaper.gain.value = 0.0001;

  // Slow breathing movement so the drone does not sit perfectly still.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = session.voice.pulse / 60;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth);
  lfoDepth.connect(shaper.gain);

  const oscillators: OscillatorNode[] = [];
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 1 / session.voice.ratios.length;

  for (const ratio of session.voice.ratios) {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = session.voice.root * ratio;
    // Each partial drifts a little against the others.
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.035 + ratio * 0.01;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = ratio * 0.6;
    drift.connect(driftDepth);
    driftDepth.connect(oscillator.frequency);
    drift.start(now);
    oscillator.connect(voiceGain);
    oscillator.start(now);
    oscillators.push(oscillator, drift);
  }

  voiceGain.connect(filter);
  filter.connect(shaper);
  shaper.connect(out);

  lfo.start(now);

  // Fade in, hold, fade out — all scheduled on the audio clock.
  const fadeIn = 3;
  const fadeOut = 6;
  shaper.gain.cancelScheduledValues(now);
  shaper.gain.setValueAtTime(0.0001, now);
  shaper.gain.linearRampToValueAtTime(0.5, now + fadeIn);
  shaper.gain.setValueAtTime(0.5, now + duration - fadeOut);
  shaper.gain.linearRampToValueAtTime(0.0001, now + duration);

  // A gentle filter sweep across the whole session.
  filter.frequency.setValueAtTime(session.voice.cutoff * 0.6, now);
  filter.frequency.linearRampToValueAtTime(session.voice.cutoff * 1.4, now + duration * 0.5);
  filter.frequency.linearRampToValueAtTime(session.voice.cutoff * 0.7, now + duration);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const at = ctx.currentTime;
    try {
      shaper.gain.cancelScheduledValues(at);
      shaper.gain.setValueAtTime(shaper.gain.value, at);
      shaper.gain.linearRampToValueAtTime(0, at + 0.4);
    } catch {
      /* the context may already be closed */
    }
    window.setTimeout(() => {
      for (const node of [...oscillators, lfo]) {
        try {
          node.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const node of [voiceGain, filter, shaper, lfoDepth]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }, 500);
  };

  // The generator schedules its own end so a session cannot outlive its length.
  window.setTimeout(stop, duration * 1000);

  return { stop, duration };
}

/** A short confirmation tone for OS-level feedback, when sound is enabled. */
export function playChime(frequency = 660): void {
  const graph = ensure();
  if (!graph) return;
  const { context: ctx, master: out } = graph;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(out);
  const now = ctx.currentTime;
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  oscillator.start(now);
  oscillator.stop(now + 0.4);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
