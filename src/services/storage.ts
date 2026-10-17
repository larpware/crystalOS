import type { PersistStorage, StorageValue } from "zustand/middleware";

/* ==========================================================================
   Local storage service

   All CrystalOS state is namespaced under `crescent.` so the OS never collides
   with anything else on the origin. Reads and writes are guarded — a corrupt
   or unavailable store degrades to in-memory defaults instead of crashing the
   desktop.
   ========================================================================== */

const PREFIX = "crescent.";

let memoryFallback: Map<string, string> | null = null;
let persistent = true;

function ensureProbe(): void {
  if (typeof window === "undefined") return;
  try {
    const probe = `${PREFIX}__probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
  } catch {
    persistent = false;
    memoryFallback = new Map();
  }
}

ensureProbe();

function backing(): Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> {
  if (persistent && typeof window !== "undefined") return window.localStorage;
  const map = memoryFallback ?? (memoryFallback = new Map());
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = backing().getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    backing().setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded — state stays in memory for this session */
  }
}

export function removeKey(key: string): void {
  try {
    backing().removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Lists CrystalOS-owned keys, used by Settings → Advanced → storage usage. */
export function listKeys(): string[] {
  const store = backing();
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length));
  }
  return keys.sort();
}

export function byteSize(): number {
  const store = backing();
  let total = 0;
  for (const key of listKeys()) {
    total += (store.getItem(PREFIX + key)?.length ?? 0) * 2;
  }
  return total;
}

/** True when localStorage is unavailable (private mode, disabled cookies). */
export function isPersistenceAvailable(): boolean {
  return persistent;
}

/** zustand persist adapter backed by the namespaced store above. */
const jsonStorageBase: PersistStorage<unknown> = {
  getItem: (name) => {
    const raw = backing().getItem(PREFIX + name);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as StorageValue<unknown>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      backing().setItem(PREFIX + name, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      backing().removeItem(PREFIX + name);
    } catch {
      /* ignore */
    }
  },
};

/** Typed view over the localStorage adapter. */
export function jsonStorageFor<T>(): PersistStorage<T> {
  return jsonStorageBase as PersistStorage<T>;
}

/* ==========================================================================
   IndexedDB — used for larger structured data: the virtual filesystem,
   user wallpapers and uploaded avatars.
   ========================================================================== */

const DB_NAME = "crystalos";
const DB_VERSION = 1;

export const IDB_STORES = {
  files: "files",
  blobs: "blobs",
  meta: "meta",
} as const;

export type IdbStore = (typeof IDB_STORES)[keyof typeof IDB_STORES];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(IDB_STORES)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore<T>(
  store: IdbStore,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function idbGet<T>(store: IdbStore, key: string): Promise<T | null> {
  return withStore<T>(store, "readonly", (os) => os.get(key));
}

export function idbPut(store: IdbStore, key: string, value: unknown): Promise<boolean> {
  return withStore<IDBValidKey>(store, "readwrite", (os) => os.put(value, key)).then(
    (result) => result !== null,
  );
}

export function idbDelete(store: IdbStore, key: string): Promise<boolean> {
  return withStore<undefined>(store, "readwrite", (os) => os.delete(key)).then(
    (result) => result !== null || true,
  );
}

export function idbKeys(store: IdbStore): Promise<string[]> {
  return withStore<IDBValidKey[]>(store, "readonly", (os) => os.getAllKeys()).then((keys) =>
    (keys ?? []).map(String),
  );
}

/**
 * zustand persist adapter for IndexedDB. The virtual filesystem and other
 * structured state live here so localStorage never fills up with file bodies.
 */
export function idbStorageFor<T>(store: IdbStore): PersistStorage<T> {
  return {
    getItem: async (name) => (await idbGet<StorageValue<T>>(store, name)) ?? null,
    setItem: async (name, value) => {
      await idbPut(store, name, value);
    },
    removeItem: async (name) => {
      await idbDelete(store, name);
    },
  };
}
