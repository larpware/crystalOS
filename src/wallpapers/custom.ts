import { IDB_STORES, idbDelete, idbGet, idbPut, loadJSON, saveJSON } from "@/services/storage";
import type { CustomWallpaperRecord } from "@/types";
import { createId } from "@/utils/format";

/* ==========================================================================
   Custom wallpapers

   User files never leave the device. Image and video bodies go into
   IndexedDB; only lightweight metadata is kept in localStorage. Object URLs
   are created lazily and cached, and are revoked when the record is removed.
   ========================================================================== */

const META_KEY = "custom-wallpapers";

export const WALLPAPER_MIME_ALLOWLIST = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "video/mp4",
  "video/webm",
];

/** Refuse anything that would blow past a sane in-browser budget. */
export const MAX_WALLPAPER_BYTES = 120 * 1024 * 1024;

const urlCache = new Map<string, string>();

export function listCustomWallpapers(): CustomWallpaperRecord[] {
  const records = loadJSON<CustomWallpaperRecord[]>(META_KEY, []);
  return Array.isArray(records) ? records.sort((a, b) => b.createdAt - a.createdAt) : [];
}

function writeRecords(records: CustomWallpaperRecord[]): void {
  saveJSON(META_KEY, records);
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  record?: CustomWallpaperRecord;
}

export async function importWallpaperFile(file: File): Promise<ImportResult> {
  if (!WALLPAPER_MIME_ALLOWLIST.includes(file.type)) {
    return {
      ok: false,
      error: `${file.type || "That file type"} is not supported. Use JPG, PNG, WebP, AVIF, GIF, MP4 or WebM.`,
    };
  }
  if (file.size > MAX_WALLPAPER_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 120 MB.`,
    };
  }

  const blobKey = createId("wp");
  const stored = await idbPut(IDB_STORES.blobs, blobKey, file);
  if (!stored) {
    return { ok: false, error: "Could not save the file to local storage." };
  }

  const record: CustomWallpaperRecord = {
    id: createId("cwp"),
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Imported wallpaper",
    kind: file.type.startsWith("video/") ? "live" : "image",
    mime: file.type,
    blobKey,
    createdAt: Date.now(),
  };

  writeRecords([record, ...listCustomWallpapers()]);
  return { ok: true, record };
}

/** Resolves a record to a playable displayable URL, cached per session. */
export async function resolveWallpaperUrl(record: CustomWallpaperRecord): Promise<string | null> {
  const cached = urlCache.get(record.blobKey);
  if (cached) return cached;

  const blob = await idbGet<Blob>(IDB_STORES.blobs, record.blobKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(record.blobKey, url);
  return url;
}

export async function deleteCustomWallpaper(record: CustomWallpaperRecord): Promise<void> {
  const cached = urlCache.get(record.blobKey);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(record.blobKey);
  }
  await idbDelete(IDB_STORES.blobs, record.blobKey);
  writeRecords(listCustomWallpapers().filter((item) => item.id !== record.id));
}

export async function renameCustomWallpaper(record: CustomWallpaperRecord, name: string): Promise<void> {
  writeRecords(
    listCustomWallpapers().map((item) =>
      item.id === record.id ? { ...item, name: name.slice(0, 48) } : item,
    ),
  );
}

export function findCustomWallpaper(id: string): CustomWallpaperRecord | undefined {
  return listCustomWallpapers().find((record) => record.id === id);
}

/** Frees every cached object URL. Used when resetting the profile. */
export function releaseWallpaperUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}
