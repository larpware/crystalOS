import { ProxiedApp } from "@/apps/proxy/ProxiedApp";
import type { AppProps } from "@/types";

/* ==========================================================================
   Discord

   A window around discord.com/app loaded through the shared Scramjet proxy.
   Account sign-in, notifications and message state are Discord's own service;
   CrystalOS only runs the site inside its own window.
   ========================================================================== */

export const DISCORD_DESTINATION = "https://discord.com/app";

export function Discord(props: AppProps) {
  return (
    <ProxiedApp
      {...props}
      options={{
        destination: DISCORD_DESTINATION,
        label: "Discord",
        icon: "discord",
        addressBar: "readonly",
        destinationNote:
          "Loading discord.com/app through the Scramjet proxy. Sign-in, servers and messages are handled by Discord.",
      }}
    />
  );
}

export default Discord;
