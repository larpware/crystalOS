import { ProxiedApp } from "@/apps/proxy/ProxiedApp";
import type { AppProps } from "@/types";

/* ==========================================================================
   Spotify

   A window around open.spotify.com loaded through the shared Scramjet service.
   Playback in a proxied web player depends on the site's own DRM/streaming
   rules; the application reports what actually happened instead of claiming
   that it plays audio.
   ========================================================================== */

export const SPOTIFY_DESTINATION = "https://open.spotify.com/";

export function Spotify(props: AppProps) {
  return (
    <ProxiedApp
      {...props}
      options={{
        destination: SPOTIFY_DESTINATION,
        label: "Spotify",
        icon: "spotify",
        addressBar: "readonly",
        destinationNote:
          "Loading open.spotify.com through the Scramjet proxy. Sign-in, playback and account state are handled by Spotify.",
      }}
    />
  );
}

export default Spotify;
