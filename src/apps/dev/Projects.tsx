import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, IconButton, Textarea } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import type { IconName } from "@/icons/icons";
import { notify } from "@/services/os";
import { childrenOf, descendantSize, homeNodeId, useFsStore } from "@/state/fs";
import type { FileNode } from "@/types";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Projects

   The workspace Crystal Dev can honestly offer: this browser profile's own
   virtual filesystem, where a project is a folder of real files with real
   contents. There is no access to the machine's disk — a web page cannot have
   it — so the pane says so instead of implying a mount it does not have.

   Editing writes through the same store the Terminal and Notes use, so a file
   changed here is changed everywhere, and it survives reloads with the rest
   of the profile.
   ========================================================================== */

interface TreeNode {
  node: FileNode;
  depth: number;
}

/** Every descendant of `rootId`, depth-first, with its nesting level. */
function flatten(nodes: FileNode[], rootId: string): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const child of childrenOf(nodes, parentId)) {
      out.push({ node: child, depth });
      if (child.kind === "folder") walk(child.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

function fileGlyph(node: FileNode): IconName {
  if (node.kind === "folder") return "folder";
  if ((node.mime ?? "").startsWith("image/")) return "image";
  if ((node.mime ?? "").startsWith("video/")) return "video";
  return "file-text";
}

export function Projects() {
  const nodes = useFsStore((state) => state.nodes);
  const home = homeNodeId(nodes);

  /* ~/Projects exists in the seed profile; one that does not have it gets it
     created on first use rather than starting from an empty explanation. */
  const projectsFolder = useMemo(
    () => childrenOf(nodes, home).find((entry) => entry.kind === "folder" && entry.name === "Projects") ?? null,
    [nodes, home],
  );

  const projects = useMemo(
    () => (projectsFolder ? childrenOf(nodes, projectsFolder.id) : []),
    [nodes, projectsFolder],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const selected = projects.find((entry) => entry.id === selectedId) ?? projects[0] ?? null;
  const tree = useMemo(
    () => (selected ? flatten(nodes, selected.id) : []),
    [nodes, selected],
  );
  const openFile = openFileId ? (nodes.find((entry) => entry.id === openFileId) ?? null) : null;
  const dirty = openFile ? draft !== null && draft !== (openFile.content ?? "") : false;

  const ensureProjectsFolder = (): string | null => {
    if (projectsFolder) return projectsFolder.id;
    return useFsStore.getState().createFolder(home, "Projects");
  };

  const newProject = () => {
    const name = window.prompt("Project name", "New project");
    if (!name?.trim()) return;
    const parentId = ensureProjectsFolder();
    if (!parentId) return;
    const id = useFsStore.getState().createFolder(parentId, name.trim());
    setSelectedId(id);
    setOpenFileId(null);
  };

  const newFile = () => {
    if (!selected) return;
    const name = window.prompt("File name", "index.html");
    if (!name?.trim()) return;
    const id = useFsStore.getState().createFile(selected.id, name.trim(), "", "text/plain");
    setOpenFileId(id);
    setDraft("");
  };

  const save = () => {
    if (!openFile || draft === null) return;
    useFsStore.getState().setContent(openFile.id, draft);
    notify({ title: "Crystal Dev", body: `${openFile.name} saved.` });
  };

  const download = () => {
    if (!openFile) return;
    const blob = new Blob([openFile.content ?? ""], { type: openFile.mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = openFile.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const discard = () => setDraft(openFile ? openFile.content ?? "" : null);

  if (projectsFolder === null) {
    return (
      <div className="cr-dev__pane">
        <EmptyState
          icon="folder"
          title="No Projects folder yet"
          hint="A project is a folder of files stored in this browser profile's virtual filesystem."
          action={
            <Button variant="primary" icon="plus" onClick={newProject}>
              Create the Projects folder
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="cr-dev__pane cr-dev-projects">
      <header className="cr-dev__pane-head">
        <div>
          <h2>Projects</h2>
          <p className="cr-row__desc">
            Files live in this browser profile's virtual filesystem — CrystalOS has no access to
            your computer's disk.
          </p>
        </div>
        <div className="cr-dev__pane-actions">
          <Button icon="plus" onClick={newProject}>
            New project
          </Button>
          <Button icon="file" disabled={!selected} onClick={newFile}>
            New file
          </Button>
        </div>
      </header>

      <div className="cr-dev-projects__body">
        <aside className="cr-dev-projects__list" aria-label="Projects">
          {projects.length === 0 && <p className="cr-row__desc">No projects yet.</p>}
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="cr-dev-projects__item"
              data-active={project.id === selected?.id}
              onClick={() => {
                setSelectedId(project.id);
                setOpenFileId(null);
                setDraft(null);
              }}
            >
              <Icon name="folder" size={14} />
              <span className="cr-dev-projects__item-name">{project.name}</span>
              <span className="cr-row__desc">{descendantSize(nodes, project.id)} B</span>
            </button>
          ))}
        </aside>

        <section className="cr-dev-projects__tree" aria-label="Files">
          {selected ? (
            <>
              <header className="cr-dev-projects__tree-head">
                <strong>{selected.name}</strong>
                <Badge>
                  {descendantSize(nodes, selected.id)} B · modified {formatRelative(selected.modified)}
                </Badge>
              </header>
              {tree.length === 0 && <p className="cr-row__desc">This folder is empty.</p>}
              {tree.map(({ node, depth }) => (
                <button
                  key={node.id}
                  type="button"
                  className="cr-dev-projects__file"
                  data-active={node.id === openFileId}
                  style={{ paddingLeft: 10 + depth * 14 }}
                  onClick={() => {
                    if (node.kind === "folder") return;
                    setOpenFileId(node.id);
                    setDraft(node.content ?? "");
                  }}
                >
                  <Icon name={fileGlyph(node)} size={13} />
                  <span>{node.name}</span>
                  {node.kind === "folder" && <span className="cr-row__desc">folder</span>}
                </button>
              ))}
            </>
          ) : (
            <EmptyState icon="folder" title="Pick a project" hint="Its files appear here." />
          )}
        </section>

        <section className="cr-dev-projects__editor" aria-label="Editor">
          {openFile ? (
            <>
              <header className="cr-dev-projects__editor-head">
                <strong>{openFile.name}</strong>
                {dirty && <Badge tone="warning">Unsaved</Badge>}
                <span className="cr-dev-projects__editor-spacer" />
                <IconButton icon="download" label={`Download ${openFile.name}`} onClick={download} />
                <Button size="sm" variant="ghost" onClick={discard} disabled={!dirty}>
                  Discard
                </Button>
                <Button size="sm" variant="primary" icon="check" onClick={save} disabled={!dirty}>
                  Save
                </Button>
              </header>
              <Textarea
                className="cr-dev-projects__editor-area"
                value={draft ?? ""}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                aria-label={`Editing ${openFile.name}`}
              />
              <p className="cr-row__desc">
                {formatRelative(openFile.modified)} · {openFile.content?.length ?? 0} characters
              </p>
            </>
          ) : (
            <EmptyState
              icon="notes"
              title="No file open"
              hint="Pick a file on the left, or create one. Saved files are readable from the Terminal and Notes too."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default Projects;
