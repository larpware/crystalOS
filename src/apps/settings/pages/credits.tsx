import { Badge, Button, Row, Section } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { credits, creditGroups, SYSTEM_VERSION, type CreditEntry } from "@/version";

/* ==========================================================================
   Settings — credits and licences

   Every third-party work used by this build, grouped by the role it plays,
   with the licence it is used under and a link to the source. Entries marked
   "Bundled" ship inside what the browser downloads; the rest are used while
   the project is built or developed and are not redistributed.
   ========================================================================== */

const groupNote: Record<CreditEntry["group"], string> = {
  "Interface and runtime": "Libraries that run inside the OS in the browser.",
  "Build and tooling": "Used to develop and build the project. Not shipped.",
  "Browsing proxy":
    "The proxy stack behind CrystalOS Browser and every proxied application. Licensing note: Scramjet, its transports and the Wisp server are copyleft, so a modified version of them must be published under the same licence.",
  "Artwork and content": "Images, catalogue data and brand material.",
  "Development guidance": "Material consulted while designing this interface.",
};

export function CreditsPage() {
  const bundled = credits.filter((entry) => entry.bundled).length;

  return (
    <>
      <Section
        title="This build"
        description="CrystalOS itself, and what it is standing on."
      >
        <Row
          label="CrystalOS"
          description={`Version ${SYSTEM_VERSION.version} “${SYSTEM_VERSION.codename}” · ${SYSTEM_VERSION.build}`}
        />
        <Row
          label="Third-party works"
          description={`${credits.length} listed — ${bundled} of them ship inside the browser build, the rest are development-time only.`}
        />
        <Row
          label="Licence obligations"
          description="Copyleft components (Scramjet, the Wisp server, the libcurl transport) are used unmodified. If you patch them, publish your changes under the same licence."
          control={
            <Badge tone="warning">
              <Icon name="shield" size={12} /> Review before redistribution
            </Badge>
          }
        />
      </Section>

      {creditGroups.map((group) => {
        const entries = credits.filter((entry) => entry.group === group);
        if (entries.length === 0) return null;
        return (
          <Section key={group} title={group} description={groupNote[group]}>
            <div className="cr-credit-list">
              {entries.map((entry) => (
                <article className="cr-credit" key={entry.name}>
                  <header className="cr-credit__head">
                    <h3 className="cr-credit__name">{entry.name}</h3>
                    {entry.bundled && <Badge tone="accent">Bundled</Badge>}
                  </header>
                  <p className="cr-credit__role">{entry.role}</p>
                  <footer className="cr-credit__meta">
                    <span className="cr-credit__licence">{entry.licence}</span>
                    {entry.url && (
                      <a
                        className="cr-credit__link"
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {entry.url.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </Section>
        );
      })}

      <Section
        title="Using someone else's work"
        description="If you build on CrystalOS, keep this page honest: add an entry here for anything you bring in, with its real licence."
      >
        <Row
          label="Export this list"
          description="Copies the credits as plain text so they can be pasted into a NOTICE file."
          control={
            <Button
              icon="copy"
              onClick={() => {
                const text = credits
                  .map(
                    (entry) =>
                      `${entry.name} — ${entry.licence}\n  ${entry.role}${entry.url ? `\n  ${entry.url}` : ""}`,
                  )
                  .join("\n\n");
                void navigator.clipboard?.writeText(
                  `CrystalOS ${SYSTEM_VERSION.version} (${SYSTEM_VERSION.build}) third-party notices\n\n${text}\n`,
                );
              }}
            >
              Copy credits
            </Button>
          }
        />
      </Section>
    </>
  );
}

export default CreditsPage;
