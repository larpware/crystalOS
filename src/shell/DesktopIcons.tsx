/** Path to the bundled document icon for text/file types. */
const DOCUMENT_ICON = "/icons/apps/documents.png";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "@/components/ui";
import { AppIcon } from "@/icons/Icon";
import { metaFor } from "@/apps/catalog";
import { childrenOf, desktopFolderId, useFsStore } from "@/state/fs";
import { panelReservedTop, useShellStore } from "@/state/shell";
import { openNode } from "@/services/os";
import type { FileNode } from "@/types";
import { GRID_GAP, GRID_PADDING, ROW_CELL, desktopSlot } from "./desktopGrid";

/* ==========================================================================
   Desktop icons

   The contents of ~/Desktop drawn on the desktop layer. Every entry is a real
   filesystem node: double-clicking opens it in the application that reads it,
   F2 renames it in place, Delete moves it to the Trash and it can be dragged
   to a grid slot.

   The artwork is hand-authored SVG on a 40px art box: a paper-coloured sheet
   with a folded corner, tinted per file type, so a desktop full of documents
   reads as one family instead of a row of identical outlines.
   ========================================================================== */

type ArtKind = "folder" | "text" | "image" | "audio" | "video" | "archive" | "file";

function artKind(node: FileNode): ArtKind {
  if (node.kind === "folder") return "folder";
  const mime = node.mime ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/json" || mime === "application/xml") return "text";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip")) return "archive";
  return "file";
}

function extensionOf(name: string): string | null {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? match[1].toUpperCase() : null;
}

/** Document sheet: paper with a folded corner and a type-coloured edge. */
function SheetGlyph({ kind, label }: { kind: ArtKind; label: string | null }) {
  const tint = `var(--file-${kind})`;
  return (
    <svg className="cr-fileglyph cr-fileglyph--sheet" viewBox="0 0 40 46" aria-hidden="true">
      <path
        className="cr-fileglyph__body"
        d="M6 5.6A3.1 3.1 0 0 1 9.1 2.5h14.2L34 12.3v28.1a3.1 3.1 0 0 1-3.1 3.1H9.1A3.1 3.1 0 0 1 6 40.4Z"
        fill="var(--icon-surface)"
        stroke={tint}
        strokeWidth={1.2}
      />
      <path className="cr-fileglyph__fold" d="M23.3 2.5 34 12.3h-7.6a3.1 3.1 0 0 1-3.1-3.1Z" />
      <path className="cr-fileglyph__edge" d="M23.3 2.5 34 12.3h-7.6a3.1 3.1 0 0 1-3.1-3.1Z" fill={tint} />
      <rect className="cr-fileglyph__rule" x="11" y="19" width="18" height="1.9" rx="0.95" fill="var(--text-muted)" />
      <rect className="cr-fileglyph__rule" x="11" y="25" width="14" height="1.9" rx="0.95" fill="var(--text-muted)" />
      <rect className="cr-fileglyph__rule" x="11" y="31" width="10" height="1.9" rx="0.95" fill="var(--text-muted)" />
      {kind === "text" && (
        <g>
          <rect x="27" y="7" width="10" height="10" rx="2" fill={tint} opacity="0.9" />
          <text
            x="32"
            y="14.5"
            fill="var(--icon-surface)"
            fontSize="6px"
            fontWeight="600"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {label}
          </text>
        </g>
      )}
      {kind === "archive" && (
        <g>
          <path d="M28.5 9a3 3 0 0 1 3 3v2h-6v-2a3 3 0 0 1 3-3z" fill={tint} opacity="0.9" />
          <path d="M27 13l3 3 3-3" stroke="var(--icon-surface)" strokeWidth="1" fill="none" />
        </g>
      )}
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg className="cr-fileglyph cr-fileglyph--folder" viewBox="0 0 46 40" aria-hidden="true">
      <path
        className="cr-fileglyph__folder-back"
        d="M4 9.2A4.2 4.2 0 0 1 8.2 5h7.4c1.3 0 2.5.6 3.3 1.7l1.6 2.1H38a4.2 4.2 0 0 1 4.2 4.2v17A4.2 4.2 0 0 1 38 34.2H8.2A4.2 4.2 0 0 1 4 30Z"
      />
      <path
        className="cr-fileglyph__folder-front"
        d="M4 14.4h38v15.8A4.2 4.2 0 0 1 37.8 34.4H8.2A4.2 4.2 0 0 1 4 30.2Z"
      />
      <path className="cr-fileglyph__folder-lip" d="M4 14.4h38" />
    </svg>
  );
}

function ImageGlyph({ node }: { node: FileNode }) {
  if (node.dataUrl) {
    return <img className="cr-fileglyph__thumb" src={node.dataUrl} alt="" draggable={false} />;
  }
  return (
    <svg className="cr-fileglyph cr-fileglyph--sheet" viewBox="0 0 40 46" aria-hidden="true">
      <path
        className="cr-fileglyph__body"
        d="M6 5.6A3.1 3.1 0 0 1 9.1 2.5h14.2L34 12.3v28.1a3.1 3.1 0 0 1-3.1 3.1H9.1A3.1 3.1 0 0 1 6 40.4Z"
      />
      <path className="cr-fileglyph__fold" d="M23.3 2.5 34 12.3h-7.6a3.1 3.1 0 0 1-3.1-3.1Z" />
      <path
        className="cr-fileglyph__art"
        d="M10.5 33.2 16 26l4.2 5.1 3.1-3.6 6.2 5.7Z"
        style={{ fill: "var(--file-image)" }}
      />
      <circle className="cr-fileglyph__art" cx="15.4" cy="19.6" r="3.1" style={{ fill: "var(--file-image)" }} />
    </svg>
  );
}

function NodeArt({ node, size }: { node: FileNode; size: number }) {
  // An application shortcut wears the application's own artwork, so a desktop
  // entry is recognisable by the same icon the dock shows.
  if (node.appId) {
    const meta = metaFor(node.appId);
    return (
      <AppIcon
        appId={node.appId}
        name={meta?.icon ?? "grid"}
        size={Math.round(size * 0.72)}
      />
    );
  }
  const kind = artKind(node);
  if (kind === "folder") return <FolderGlyph />;
  if (kind === "image") return <ImageGlyph node={node} />;
  if (kind === "text" || kind === "file") {
    const label = extensionOf(node.name);
    return (
      <span className="cr-fileglyph cr-fileglyph__document">
        <img
          className="cr-fileglyph__document-img"
          src={DOCUMENT_ICON}
          alt=""
          draggable={false}
        />
        {label && (
          <span className="cr-fileglyph__document-badge" style={{ backgroundColor: `var(--file-${kind})` }}>
            {label}
          </span>
        )}
      </span>
    );
  }
  return <SheetGlyph kind={kind} label={extensionOf(node.name)} />;
}

export function DesktopIcons() {
  const nodes = useFsStore((state) => state.nodes);
  const selection = useFsStore((state) => state.selection);
  const setDesktopPosition = useFsStore((state) => state.setDesktopPosition);
  const setSelection = useFsStore((state) => state.setSelection);
  const trashMany = useFsStore((state) => state.trashMany);
  const config = useShellStore((state) => state.desktop);
  const renameRequest = useShellStore((state) => state.renameRequest);
  const clearRenameRequest = useShellStore((state) => state.clearRenameRequest);
  const panel = useShellStore((state) => state.panel);
  const dockArea = useShellStore((state) => state.safeArea.bottom);
  /* Derived from the panel settings, not from the shell's layout pass: an icon
     must never be laid out under the bar, not even for the commit in which the
     bar's own settings changed. */
  const panelHeight = panelReservedTop(panel.panelScale, panel.style);

  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const folderId = useMemo(() => desktopFolderId(nodes), [nodes]);
  const entries = useMemo(
    () => childrenOf(nodes, folderId).filter((node) => node.kind === "folder" || node.kind === "file"),
    [nodes, folderId],
  );

  const columns = useMemo(() => {
    const cell = config.iconSize + GRID_GAP;
    const available = Math.max(
      1,
      Math.floor((window.innerHeight - panelHeight - dockArea - GRID_PADDING) / cell),
    );
    return Math.max(1, available);
  }, [config.iconSize, dockArea, panelHeight]);

  const columnWidth = config.iconSize + GRID_GAP;
  /*
   * How much room a name gets: the grid column, less a hair of the gap.
   *
   * This is what makes a label read like a filename instead of a word puzzle —
   * it may be wider than the artwork above it, because the name is the thing
   * being read — without ever reaching its neighbour's label. With the default
   * icon size that is 82px, which fits "Shortcuts.txt" on one line; picking
   * smaller icons narrows the label, and the hover tooltip covers what is left.
   */
  const labelWidth = columnWidth - 4;

  /* The context menu and F2 both rename; the request travels through the shell. */
  useEffect(() => {
    if (!renameRequest) return;
    const node = nodes.find((entry) => entry.id === renameRequest);
    clearRenameRequest();
    if (!node) return;
    setRenaming(node.id);
    setRenameValue(node.name);
  }, [clearRenameRequest, nodes, renameRequest]);

  const commitRename = useCallback(
    (id: string) => {
      const next = renameValue.trim();
      if (next) useFsStore.getState().rename(id, next);
      setRenaming(null);
    },
    [renameValue],
  );

  const positionFor = useCallback(
    (node: FileNode, index: number): { x: number; y: number } => {
      // Auto-placed icons start below the strip the top bar reserves, and a
      // hand-placed one is only drawn there — where the user actually dropped it
      // is left alone, so switching the bar back to full width restores it.
      const top = panelHeight;
      if (node.desktopPosition) {
        return { x: node.desktopPosition.x, y: Math.max(node.desktopPosition.y, top) };
      }
      const column = Math.floor(index / columns);
      const row = index % columns;
      return {
        x: GRID_PADDING + column * columnWidth,
        y: top + row * ROW_CELL,
      };
    },
    [columns, columnWidth, panelHeight],
  );

  const onPointerDown = useCallback(
    (node: FileNode) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (renaming === node.id) return;
      setSelection([node.id]);
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setDrag({
        id: node.id,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort; the drag still tracks pointermove */
      }
    },
    [renaming, setSelection],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drag || !config.alignToGrid) return;
      // Applied straight away: deferring to an animation frame means a stalled
      // compositor freezes the icon mid-drag, and a pointermove is already
      // coalesced to one per frame by the browser.
      setDesktopPosition(
        drag.id,
        desktopSlot(
          event.clientX - drag.offsetX,
          event.clientY - drag.offsetY,
          config.iconSize,
          panelHeight,
        ),
      );
    },
    [config.alignToGrid, config.iconSize, drag, panelHeight, setDesktopPosition],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (drag) {
        setDesktopPosition(
          drag.id,
          desktopSlot(
            event.clientX - drag.offsetX,
            event.clientY - drag.offsetY,
            config.iconSize,
            panelHeight,
          ),
        );
      }
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* nothing to release */
      }
      setDrag(null);
    },
    [config.iconSize, drag, panelHeight, setDesktopPosition],
  );

  if (!config.showIcons || entries.length === 0) return null;

  return (
    <div className="cr-desktop-icons" role="list">
      {entries.map((node, index) => {
        const position = positionFor(node, index);
        const width = config.iconSize;
        const selected = selection.includes(node.id);
        return (
          <div
            key={node.id}
            role="listitem"
            className="cr-desktop-icon"
            data-kind={node.appId ? "app" : artKind(node)}
            data-selected={selected}
            data-dragging={drag?.id === node.id}
            style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)`, width }}
            tabIndex={0}
            aria-label={`${node.name}${node.kind === "folder" ? " folder" : ""}`}
            onPointerDown={onPointerDown(node)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => openNode(node.id)}
            onFocus={() => setSelection([node.id])}
            onKeyDown={(event) => {
              if (event.key === "Enter") openNode(node.id);
              if (event.key === "Delete") trashMany([node.id]);
              if (event.key === "F2") {
                event.preventDefault();
                setRenaming(node.id);
                setRenameValue(node.name);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              // Without this the desktop's own handler, one layer up, claims the
              // click and the icon's menu is replaced by the desktop menu.
              event.stopPropagation();
              setSelection([node.id]);
              useShellStore.getState().openContextMenu({
                x: event.clientX,
                y: event.clientY,
                target: "file",
                payload: { nodeId: node.id },
              });
            }}
          >
            <span className="cr-desktop-icon__glyph" style={{ width, height: Math.round(width * 1.08) }}>
              <NodeArt node={node} size={width} />
            </span>
            {renaming === node.id ? (
              <input
                className="cr-input cr-desktop-icon__rename"
                value={renameValue}
                autoFocus
                aria-label={`Rename ${node.name}`}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => commitRename(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename(node.id);
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              /*
               * The label is clamped to two lines, so the tooltip is where the
               * whole filename lives — the platform convention for a truncated
               * name. It is always there rather than swapped in when the name
               * looks long: how much text fits is a measurement, and measuring
               * a line-clamped element from inside React is unreliable (the
               * clamped box reports no overflow), so the honest answer is to
               * offer the full name on hover every time.
               */
              <Tooltip label={node.name}>
                <span className="cr-desktop-icon__label" style={{ width: labelWidth }}>
                  {node.name}
                </span>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
