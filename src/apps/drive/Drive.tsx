import { ProxiedApp } from "@/apps/proxy/ProxiedApp";
import type { AppProps } from "@/types";

/* ==========================================================================
   Drive

   CrystalOS has no local file manager in the application lineup; Drive is the
   document surface. It loads the real Google Drive through Scramjet, so signing
   in, browsing and editing happen exactly as they do in the browser — the OS
   only supplies the window it runs in.
   ========================================================================== */

export const DRIVE_DESTINATION = "https://drive.google.com/";

export function Drive(props: AppProps) {
  return (
    <ProxiedApp
      {...props}
      options={{
        destination: DRIVE_DESTINATION,
        label: "Drive",
        icon: "drive",
        addressBar: "readonly",
        destinationNote:
          "Loading Google Drive through the Scramjet proxy. Sign-in and file handling happen on Google's own pages.",
      }}
    />
  );
}

export default Drive;
