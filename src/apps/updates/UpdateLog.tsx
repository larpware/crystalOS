import { useState } from "react";
import { Badge, Button, IconButton, Segmented } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { appCatalog } from "@/apps/catalog";
import { releaseNotes, SYSTEM_VERSION } from "@/version";
import type { ReleaseNote } from "@/types";

/* ==========================================================================
   Update Log

   Release notes come from the version manifest — the same object the About page
   and the store read. Nothing here is typed out for show.
   ========================================================================== */

type Tab = "os" | "applications";

export function UpdateLog() {
  const [tab, setTab] = useState<Tab>("os");
  const [expanded, setExpanded] = useState<string[]>([releaseNotes[0]?.version ?? ""]);

  const toggle = (version: string) =>
    setExpanded((current) =>
      current.includes(version) ? current.filter((item) => item !== version) : [...current, version],
    );

  return (
    <div className="cr-updates">
      <header className="cr-updates__bar">
        <Segmented
          label="Update log source"
          value={tab}
          onChange={setTab}
          options={[
            { value: "os", label: "CrystalOS" },
            { value: "applications", label: "Applications" },
          ]}
        />
        <div className="cr-updates__current">
          <Icon name="updates" size={15} />
          <span className="cr-num">
            {SYSTEM_VERSION.version} · {SYSTEM_VERSION.build}
          </span>
          <Badge tone="accent">{SYSTEM_VERSION.releaseDate}</Badge>
        </div>
      </header>

      <div className="cr-updates__scroll">
        {tab === "os" ? (
          <div className="cr-updates__list">
            {releaseNotes.map((note) => (
              <ReleaseCard
                key={note.version}
                note={note}
                open={expanded.includes(note.version)}
                current={note.version === SYSTEM_VERSION.version}
                onToggle={() => toggle(note.version)}
              />
            ))}
          </div>
        ) : (
          <div className="cr-updates__apps">
            <p className="cr-row__desc">
              Application versions ship inside the OS build. This is the version each one reports
              in this build.
            </p>
            <div className="cr-updates__table">
              <div className="cr-updates__table-head">
                <span>Application</span>
                <span>Version</span>
                <span>Bundled</span>
              </div>
              {[...appCatalog]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((meta) => (
                  <div key={meta.id} className="cr-updates__table-row">
                    <span>{meta.name}</span>
                    <span className="cr-num">{meta.version}</span>
                    <span className="cr-row__desc">
                      {meta.system ? "With the OS" : "Optional"}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReleaseCard({
  note,
  open,
  current,
  onToggle,
}: {
  note: ReleaseNote;
  open: boolean;
  current: boolean;
  onToggle: () => void;
}) {
  const groups: { key: keyof ReleaseNote; label: string; tone: "success" | "accent" | "warning" | "danger" }[] = [
    { key: "added", label: "Added", tone: "success" },
    { key: "changed", label: "Changed", tone: "accent" },
    { key: "fixed", label: "Fixed", tone: "warning" },
    { key: "known", label: "Known issues", tone: "danger" },
  ];

  const total = groups.reduce((sum, group) => {
    const value = note[group.key];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);

  return (
    <section className="cr-release" data-open={open}>
      <header className="cr-release__head">
        <button type="button" className="cr-release__toggle" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={15} />
          <span className="cr-release__version">Version {note.version}</span>
          {current && <Badge tone="accent">Installed</Badge>}
          <span className="cr-release__date">{note.date}</span>
          <span className="cr-release__count cr-row__desc">{total} entries</span>
        </button>
        <IconButton
          icon={open ? "collapse" : "expand"}
          label={open ? "Collapse release" : "Expand release"}
          onClick={onToggle}
        />
      </header>

      {open && (
        <div className="cr-release__body">
          {groups.map((group) => {
            const value = note[group.key];
            if (!Array.isArray(value) || value.length === 0) return null;
            return (
              <div key={group.key} className="cr-release__group">
                <h4>
                  <Badge tone={group.tone}>{group.label}</Badge>
                </h4>
                <ul>
                  {value.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          })}
          <footer className="cr-release__foot">
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={() => {
                const text = groups
                  .map((group) => {
                    const value = note[group.key];
                    if (!Array.isArray(value) || value.length === 0) return "";
                    return `${group.label}\n${value.map((line) => `- ${line}`).join("\n")}`;
                  })
                  .filter(Boolean)
                  .join("\n\n");
                void navigator.clipboard.writeText(`CrystalOS ${note.version} (${note.date})\n\n${text}`);
              }}
            >
              Copy release notes
            </Button>
          </footer>
        </div>
      )}
    </section>
  );
}

export default UpdateLog;
