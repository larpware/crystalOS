import { ProxiedApp } from "@/apps/proxy/ProxiedApp";
import type { AppProps } from "@/types";

/* ==========================================================================
   Audiomack

   Same proxied surface as Spotify: the real audiomack.com through Scramjet.
   ========================================================================== */

export const AUDIOMACK_DESTINATION = "https://audiomack.com/";

export function Audiomack(props: AppProps) {
  return (
    <ProxiedApp
      {...props}
      options={{
        destination: AUDIOMACK_DESTINATION,
        label: "Audiomack",
        icon: "audiomack",
        addressBar: "readonly",
        destinationNote:
          "Loading audiomack.com through the Scramjet proxy. Streaming and sign-in are handled by Audiomack.",
      }}
    />
  );
}

export default Audiomack;
