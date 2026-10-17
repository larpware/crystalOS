import { ProxiedApp } from "@/apps/proxy/ProxiedApp";
import type { AppProps } from "@/types";

/* ==========================================================================
   QMovies

   The movie and series application: this project's own QMovies site, run from
   its local development server (the QMovies workspace on this machine, serving
   on port 8080) and shown in a window of its own.

   Both ways of loading it are supported on purpose, and the button in this
   window's toolbar switches between them:

   - Direct (the default): the window frames the local server by its real
     address, so the site's own router, storage and video playback behave
     exactly as they do in a browser tab.
   - Through Scramjet: the same address is loaded by the proxy. A loopback
     address is private, so the backend has to be started with
     `CRESCENT_ALLOW_PRIVATE_IPS=1`; when it is not, this window says so
     instead of showing a blank page.

   `QMOVIES_DESTINATION` is the single place the address lives, and opening the
   app with a `url` argument still overrides it.
   ========================================================================== */

export const QMOVIES_DESTINATION = "http://localhost:8080/";

export function QMovies(props: AppProps) {
  return (
    <ProxiedApp
      {...props}
      options={{
        destination: QMOVIES_DESTINATION,
        label: "QMovies",
        icon: "qmovies",
        addressBar: "readonly",
        mode: "direct",
        directReason:
          "QMovies runs on this machine, so this window frames its local server by its real address: the site's own router, storage and playback behave exactly as they do in a browser tab. The proxy button in this toolbar loads the same address through Scramjet when you want it.",
        destinationNote:
          "Loading the local QMovies server. The catalogue, streaming and any account are QMovies' own service.",
      }}
    />
  );
}

export default QMovies;
