import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";

/* ==========================================================================
   Playback

   One place owns the system output level so the Music player, the Media app
   and the panel all agree. The audio service reads `volume`/`muted` and
   applies them to the master gain; nothing displays a level it does not
   actually control.
   ========================================================================== */

export interface PlaybackState {
  volume: number;
  muted: boolean;
  /** Screen dim applied by the OS shell (the browser cannot change panel backlight). */
  dim: number;
  nowPlaying: { id: string; title: string; artist: string; appId: string } | null;
  isPlaying: boolean;
  progress: number;
  duration: number;

  setVolume: (volume: number) => void;
  toggleMuted: () => void;
  setDim: (dim: number) => void;
  setNowPlaying: (track: PlaybackState["nowPlaying"], appId?: string) => void;
  setPlaying: (isPlaying: boolean) => void;
  setProgress: (progress: number, duration?: number) => void;
}

export const usePlaybackStore = create<PlaybackState>()(
  persist(
    (set, get) => ({
      volume: 0.8,
      muted: false,
      dim: 0,
      nowPlaying: null,
      isPlaying: false,
      progress: 0,
      duration: 0,

      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: false }),
      toggleMuted: () => set({ muted: !get().muted }),
      setDim: (dim) => set({ dim: Math.max(0, Math.min(0.6, dim)) }),
      setNowPlaying: (nowPlaying) => set({ nowPlaying }),
      setPlaying: (isPlaying) => set({ isPlaying }),
      setProgress: (progress, duration) =>
        set(duration === undefined ? { progress } : { progress, duration }),
    }),
    {
      name: "playback",
      version: 1,
      storage: jsonStorageFor<PlaybackState>(),
      partialize: (state) =>
        ({ volume: state.volume, muted: state.muted, dim: state.dim }) as PlaybackState,
    },
  ),
);
