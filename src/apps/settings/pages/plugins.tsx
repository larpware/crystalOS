import { useRef, useState } from "react";
import { Badge, Button, EmptyState, Row, Section, Switch, Textarea } from "@/components/ui";
import { notify } from "@/services/os";
import { bundledManifests } from "@/services/plugins/bundled";
import {
  normalisePlugin,
  permissionLabel,
  type InstalledPlugin,
  type PluginManifest,
  type PluginPermission,
} from "@/services/plugins/manifest";
import { usePluginStore } from "@/services/plugins/store";

/* ==========================================================================
   Plugins

   Three things this page is careful about, because they are the whole point of
   the feature:

     - Nothing installs until the permissions have been read. Adding a manifest
       stages it and shows what it is asking for; the install button is a
       separate press. A plugin that arrives from a file goes through exactly
       the same review as one typed in.
     - A refused manifest says why, per line, rather than "invalid plugin".
     - The list of what a plugin *cannot* do is on the page, not in a doc.
   ========================================================================== */

function PermissionList({ permissions }: { permissions: PluginPermission[] }) {
  if (permissions.length === 0) {
    return <span className="cr-plugin__meta">Asks for nothing, so it can do nothing.</span>;
  }
  return (
    <div className="cr-plugin__permissions">
      {permissions.map((permission) => (
        <Badge key={permission}>{permissionLabel(permission)}</Badge>
      ))}
    </div>
  );
}

function PluginHead({ plugin }: { plugin: PluginManifest }) {
  return (
    <div className="cr-plugin__head">
      <div className="cr-plugin__title">{plugin.name}</div>
      <span className="cr-plugin__meta">
        v{plugin.version}
        {plugin.author ? ` · ${plugin.author}` : ""}
        {` · ${plugin.commands.length} command${plugin.commands.length === 1 ? "" : "s"}`}
      </span>
      {plugin.description && <p className="cr-plugin__desc">{plugin.description}</p>}
    </div>
  );
}

function ConsentCard({
  manifest,
  alreadyInstalled,
  onInstall,
  onCancel,
}: {
  manifest: PluginManifest;
  alreadyInstalled: boolean;
  onInstall: () => void;
  onCancel: () => void;
}) {
  const count = manifest.commands.length;
  return (
    <div className="cr-plugin-consent">
      <PluginHead plugin={manifest} />
      <p className="cr-plugin__lead">
        Installing adds {count} command{count === 1 ? "" : "s"} to the palette. It is asking to be
        allowed to:
      </p>
      <PermissionList permissions={manifest.permissions} />
      <ul className="cr-plugin__commands">
        {manifest.commands.map((command) => (
          <li key={command.id}>
            <strong>{command.name}</strong>
            {command.description ? ` — ${command.description}` : ""}
          </li>
        ))}
      </ul>
      <div className="cr-button-row">
        <Button variant="primary" icon="download" onClick={onInstall}>
          {alreadyInstalled ? "Reinstall with these permissions" : "Install"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InstalledPluginRow({
  plugin,
  onReinstall,
}: {
  plugin: InstalledPlugin;
  onReinstall: () => void;
}) {
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const remove = usePluginStore((state) => state.remove);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="cr-plugin" data-disabled={!plugin.enabled}>
      <PluginHead plugin={plugin} />
      <PermissionList permissions={plugin.permissions} />
      <div className="cr-plugin__actions">
        <Switch
          label={`Enable ${plugin.name}`}
          checked={plugin.enabled}
          onChange={(checked) => setEnabled(plugin.id, checked)}
        />
        <span className="cr-plugin__meta">{plugin.enabled ? "On" : "Off"}</span>
        {!confirming && (
          <>
            <Button size="sm" variant="ghost" icon="refresh" onClick={onReinstall}>
              Reinstall
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          </>
        )}
        {confirming && (
          <>
            <span className="cr-plugin__meta">Remove {plugin.name}?</span>
            <Button
              size="sm"
              variant="danger"
              icon="check"
              onClick={() => {
                remove(plugin.id);
                notify({ title: `${plugin.name} removed`, icon: "trash", appId: "settings" });
              }}
            >
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PluginsPage() {
  const plugins = usePluginStore((state) => state.plugins);
  const install = usePluginStore((state) => state.install);

  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<PluginManifest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isInstalled = (id: string) => plugins.some((plugin) => plugin.id === id);

  /** Reads untrusted text into a manifest and stages it for review. */
  const stage = (text: string) => {
    setPending(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setErrors([
        `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      return;
    }
    const result = normalisePlugin(parsed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setPending(result.plugin);
  };

  const commit = (manifest: PluginManifest) => {
    const result = install(manifest);
    if (!result.ok) {
      setErrors([result.message]);
      return;
    }
    setPending(null);
    setDraft("");
    notify({
      title: `${manifest.name} installed`,
      body: `${manifest.commands.length} command${manifest.commands.length === 1 ? "" : "s"} added to the palette.`,
      icon: "check",
      appId: "settings",
    });
  };

  return (
    <>
      <Section
        title="Installed"
        description="Plugins are data. Each one is a named sequence of commands CrystalOS already has, plus the permissions you agreed to when you installed it."
      >
        {plugins.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No plugins installed"
            hint="Install one from the list below, or paste a manifest of your own."
          />
        ) : (
          <div className="cr-plugin-list">
            {plugins.map((plugin) => {
              const installed = bundledManifests.find((entry) => entry.id === plugin.id);
              return (
                <InstalledPluginRow
                  key={plugin.id}
                  plugin={plugin}
                  onReinstall={() => {
                    setErrors([]);
                    setPending(
                      installed ?? {
                        id: plugin.id,
                        name: plugin.name,
                        version: plugin.version,
                        author: plugin.author,
                        description: plugin.description,
                        permissions: plugin.permissions,
                        commands: plugin.commands,
                      },
                    );
                  }}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Bundled with CrystalOS"
        description="Shipped with the OS and installed exactly the way any other plugin is."
      >
        <div className="cr-plugin-list">
          {bundledManifests.map((manifest) => {
            const already = isInstalled(manifest.id);
            return (
              <div className="cr-plugin cr-plugin--offer" key={manifest.id}>
                <PluginHead plugin={manifest} />
                <PermissionList permissions={manifest.permissions} />
                <div className="cr-plugin__actions">
                  {already && <Badge tone="success" icon="check">Installed</Badge>}
                  <Button
                    size="sm"
                    variant={already ? "ghost" : "primary"}
                    icon="download"
                    onClick={() => {
                      setErrors([]);
                      setDraft("");
                      setPending(manifest);
                    }}
                  >
                    {already ? "Review again" : "Review"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {pending && (
        <Section title="Before you install">
          <ConsentCard
            manifest={pending}
            alreadyInstalled={isInstalled(pending.id)}
            onInstall={() => commit(pending)}
            onCancel={() => setPending(null)}
          />
        </Section>
      )}

      <Section
        title="Add a plugin"
        description="Paste a manifest, or open one from a file. Nothing is installed until you have read what it asks for."
      >
        <Row stacked label="Manifest">
          <Textarea
            aria-label="Plugin manifest"
            placeholder={'{ "id": "my-plugin", "name": "My plugin", "version": "1.0.0", "permissions": ["window"], "commands": [] }'}
            value={draft}
            invalid={errors.length > 0}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
        </Row>
        <div className="cr-button-row">
          <Button variant="primary" icon="plus" disabled={!draft.trim()} onClick={() => stage(draft)}>
            Read manifest
          </Button>
          <Button icon="folder" onClick={() => fileRef.current?.click()}>
            Open a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.crescent-plugin,application/json"
            className="cr-plugin__file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const text = await file.text();
              setDraft(text);
              stage(text);
            }}
          />
        </div>
        {errors.length > 0 && (
          <ul className="cr-plugin__errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What a plugin cannot do">
        <ul className="cr-plugin__limits">
          <li>It cannot run code. A manifest has no field that can hold a function, and nothing in one is evaluated.</li>
          <li>
            It can only run commands CrystalOS already has, and only from the namespaces it was granted — a
            granted plugin cannot reach a namespace it did not ask for.
          </li>
          <li>
            It cannot run another plugin&rsquo;s commands, so it cannot borrow permissions you gave to something
            else.
          </li>
          <li>
            It cannot ask for new permissions later. Changing them means reinstalling, and it is shown to you
            again when you do.
          </li>
        </ul>
      </Section>
    </>
  );
}
