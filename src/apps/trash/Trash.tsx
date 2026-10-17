import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { Button, EmptyState, Modal } from "@/components/ui";
import { ancestorPath, trashedNodes, useFsStore } from "@/state/fs";
import { useNotificationStore } from "@/state/notifications";
import type { AppProps, FileNode } from "@/types";
import { formatBytes, formatRelative } from "@/utils/format";

function iconFor(node: FileNode): IconName {
  if (node.kind === "folder") return "folder";
  const mime = node.mime ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "music";
  if (mime.startsWith("text/")) return "file-text";
  return "file";
}

export function Trash({}: AppProps) {
  const nodes = useFsStore((state) => state.nodes);
  const restoreMany = useFsStore((state) => state.restoreMany);
  const deleteForever = useFsStore((state) => state.deleteForever);
  const emptyTrash = useFsStore((state) => state.emptyTrash);
  const notify = useNotificationStore((state) => state.notify);

  const [selection, setSelection] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<"empty" | "delete" | null>(null);

  const items = useMemo(() => trashedNodes(nodes), [nodes]);
  const totalSize = items.reduce((sum, node) => sum + (node.kind === "file" ? node.size : 0), 0);
  const selectedNodes = items.filter((node) => selection.includes(node.id));

  return (
    <div className="cr-app cr-trash">
      <div className="cr-app__header">
        <Icon name="trash" size={16} />
        <span className="cr-app__title">Trash</span>
        <span className="cr-badge">{items.length}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button
            size="sm"
            icon="refresh"
            disabled={selection.length === 0}
            onClick={() => {
              restoreMany(selection);
              setSelection([]);
              notify({
                appId: "trash",
                icon: "refresh",
                title: `Restored ${selection.length} item${selection.length === 1 ? "" : "s"}`,
                transient: true,
              });
            }}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="close"
            disabled={selection.length === 0}
            onClick={() => setConfirm("delete")}
          >
            Delete permanently
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="trash"
            disabled={items.length === 0}
            onClick={() => setConfirm("empty")}
          >
            Empty Trash
          </Button>
        </div>
      </div>

      <div className="cr-app__body">
        {items.length === 0 ? (
          <EmptyState
            icon="trash"
            title="Trash is empty"
            hint="Files you delete from Files or the Terminal land here first, and can be restored at any time."
          />
        ) : (
          <>
            <div className="cr-trash__summary">
              {items.length} item{items.length === 1 ? "" : "s"} · {formatBytes(totalSize)} of file data
              {selection.length > 0 && ` · ${selection.length} selected`}
            </div>
            <ul className="cr-list">
              {items.map((node) => {
                const path = ancestorPath(nodes, node.id);
                const original = path
                  .slice(1, -1)
                  .map((part) => part.name)
                  .join(" / ");
                return (
                  <li key={node.id}>
                    <label className="cr-list-item cr-trash__row">
                      <input
                        type="checkbox"
                        checked={selection.includes(node.id)}
                        onChange={(event) =>
                          setSelection(
                            event.target.checked
                              ? [...selection, node.id]
                              : selection.filter((id) => id !== node.id),
                          )
                        }
                        aria-label={`Select ${node.name}`}
                      />
                      <Icon name={iconFor(node)} size={16} />
                      <span className="cr-trash__name cr-truncate">{node.name}</span>
                      <span className="cr-trash__origin cr-truncate">
                        {original ? `from ${original}` : "from Root"}
                      </span>
                      <span className="cr-trash__meta cr-num">
                        {node.kind === "folder" ? "Folder" : formatBytes(node.size)}
                      </span>
                      <span className="cr-trash__meta">{formatRelative(node.modified)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Modal
        open={confirm !== null}
        title={confirm === "empty" ? "Empty Trash?" : "Delete permanently?"}
        onClose={() => setConfirm(null)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm === "empty") {
                  emptyTrash();
                  notify({
                    appId: "trash",
                    icon: "trash",
                    title: "Trash emptied",
                    body: "Deleted items cannot be recovered.",
                    transient: true,
                  });
                } else {
                  deleteForever(selection);
                  setSelection([]);
                }
                setConfirm(null);
              }}
            >
              {confirm === "empty" ? "Empty Trash" : `Delete ${selection.length} item(s)`}
            </Button>
          </>
        }
      >
        {confirm === "empty" ? (
          <p>
            This permanently removes {items.length} item{items.length === 1 ? "" : "s"} from the
            CrystalOS filesystem. This cannot be undone.
          </p>
        ) : (
          <p>
            Permanently delete {selectedNodes.length} selected item
            {selectedNodes.length === 1 ? "" : "s"}? This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
