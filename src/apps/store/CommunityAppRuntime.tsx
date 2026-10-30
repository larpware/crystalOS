import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";

export interface CommunityRuntimeApp {
  name: string;
  description?: string;
  url: string;
}

export function CommunityAppRuntime({ app, onClose }: { app: CommunityRuntimeApp; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  let url: URL;
  try { url = new URL(app.url); } catch { return <EmptyState icon="warning" title="Invalid application URL" hint="This application cannot be opened safely." />; }
  if (url.protocol !== "https:") return <EmptyState icon="warning" title="Unsafe application URL" hint="Community apps must use HTTPS." />;
  return (
    <section className="cr-store__community-runtime" aria-label={`${app.name} community app`}>
      <header className="cr-store__community-runtime-head">
        <div><strong>{app.name}</strong><span className="cr-row__desc">Community app · sandboxed</span></div>
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>Close</Button>
      </header>
      {failed ? (
        <EmptyState icon="warning" title="This application could not load" hint="The website may block embedding or be temporarily unavailable." />
      ) : (
        <iframe
          title={app.name}
          src={url.toString()}
          sandbox="allow-forms allow-modals allow-popups allow-scripts"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </section>
  );
}
