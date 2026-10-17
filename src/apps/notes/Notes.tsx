import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/icons/Icon";
import { Button, EmptyState } from "@/components/ui";
import { childrenOf, homeNodeId, useFsStore } from "@/state/fs";
import { useNotificationStore } from "@/state/notifications";
import type { AppProps } from "@/types";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Notes

   Notes are ordinary text files. They live in `~/Documents/Notes`, where the
   Terminal can reach them — no separate storage format to get out of sync.
   ========================================================================== */

const NOTES_FOLDER = "Notes";

function notesFolderId(): string {
  const nodes = useFsStore.getState().nodes;
  const existing = nodes.find(
    (node) => node.name === NOTES_FOLDER && node.kind === "folder" && !node.trashed,
  );
  if (existing) return existing.id;
  const documents = nodes.find(
    (node) => node.name === "Documents" && node.kind === "folder" && !node.trashed,
  );
  return useFsStore.getState().createFolder(documents?.id ?? homeNodeId(nodes), NOTES_FOLDER);
}

export function Notes({ args }: AppProps) {
  const nodes = useFsStore((state) => state.nodes);
  const setContent = useFsStore((state) => state.setContent);
  const createFile = useFsStore((state) => state.createFile);
  const trashMany = useFsStore((state) => state.trashMany);
  const notify = useNotificationStore((state) => state.notify);

  const folderId = useMemo(() => notesFolderId(), []);
  const notes = useMemo(
    () => childrenOf(nodes, folderId).filter((node) => node.kind === "file"),
    [nodes, folderId],
  );

  const [activeId, setActiveId] = useState<string | null>(
    (args?.noteId as string | undefined) ?? null,
  );
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedRef = useRef<string>("");
  const active = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && notes.length > 0) {
      setActiveId(notes[0].id);
      return;
    }
    if (!active) return;
    setDraft(active.content ?? "");
    savedRef.current = active.content ?? "";
    setDirty(false);
  }, [active, activeId, notes]);

  const save = useCallback(() => {
    if (!active) return;
    setContent(active.id, draft);
    savedRef.current = draft;
    setDirty(false);
    setSavedAt(Date.now());
  }, [active, draft, setContent]);

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (!dirty || !active) return;
    const timer = window.setTimeout(save, 900);
    return () => window.clearTimeout(timer);
  }, [active, dirty, save]);

  const addNote = useCallback(() => {
    const id = createFile(folderId, "Untitled note.txt", "");
    setActiveId(id);
    setDraft("");
    setDirty(false);
  }, [createFile, folderId]);

  return (
    <div className="cr-app cr-notes">
      <div className="cr-app__header">
        <Icon name="notes" size={16} />
        <span className="cr-app__title">Notes</span>
        <span className="cr-badge">{notes.length}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="cr-field__hint">
            {dirty
              ? "Unsaved changes"
              : savedAt
                ? `Saved ${formatRelative(savedAt)}`
                : active
                  ? "Up to date"
                  : "—"}
          </span>
          <Button size="sm" icon="plus" onClick={addNote}>
            New note
          </Button>
        </div>
      </div>

      <div className="cr-split">
        <aside className="cr-notes__list" aria-label="Notes">
          {notes.length === 0 ? (
            <EmptyState icon="notes" title="No notes yet" hint="Create one to get started." />
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="cr-list-item"
                data-active={note.id === activeId}
                onClick={() => {
                  if (dirty) save();
                  setActiveId(note.id);
                }}
              >
                <Icon name="file-text" size={14} />
                <span className="cr-truncate">{note.name.replace(/\.txt$/, "")}</span>
                <span className="cr-notes__time">{formatRelative(note.modified)}</span>
              </button>
            ))
          )}
        </aside>

        <div className="cr-notes__editor">
          {active ? (
            <>
              <input
                className="cr-notes__name"
                value={active.name}
                onChange={(event) => useFsStore.getState().rename(active.id, event.target.value)}
                aria-label="Note file name"
              />
              <textarea
                className="cr-notes__textarea"
                value={draft}
                spellCheck
                placeholder="Start writing…"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDirty(true);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    save();
                  }
                }}
              />
              <div className="cr-notes__foot">
                <span>{draft.length} characters · saved as a .txt file in ~/Documents/Notes</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() => {
                      trashMany([active.id]);
                      setActiveId(null);
                      notify({
                        appId: "notes",
                        icon: "trash",
                        title: "Note moved to Trash",
                        transient: true,
                      });
                    }}
                  >
                    Delete
                  </Button>
                  <Button size="sm" icon="check" disabled={!dirty} onClick={save}>
                    Save
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon="notes"
              title="Nothing selected"
              hint="Pick a note on the left, or create a new one."
              action={<Button onClick={addNote} icon="plus">New note</Button>}
            />
          )}
        </div>
      </div>
    </div>
  );
}
