export type SaveKind = "trains" | "station";

export interface SaveMeta { name: string; savedAt: string; kind: SaveKind; }

export interface SaveStorage {
  list(kind: SaveKind): Promise<SaveMeta[]>;
  read(kind: SaveKind, name: string): Promise<unknown>;
  write(kind: SaveKind, name: string, data: unknown): Promise<void>;
  remove(kind: SaveKind, name: string): Promise<void>;
}

const DB_NAME = "gid-ural-saves";
const DB_VERSION = 1;
const STORE_NAME = "saves";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE_NAME, mode);
    const store = t.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

interface SaveRecord {
  key: string; // `${kind}:${name}`
  name: string;
  kind: SaveKind;
  savedAt: string;
  data: unknown;
}

function indexedDbStorage(): SaveStorage {
  return {
    async list(kind) {
      const all = await tx<SaveRecord[]>("readonly", s => s.getAll() as IDBRequest<SaveRecord[]>);
      return all
        .filter(r => r.kind === kind)
        .map(r => ({ name: r.name, savedAt: r.savedAt, kind: r.kind }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async read(kind, name) {
      const key = `${kind}:${name}`;
      const rec = await tx<SaveRecord | undefined>("readonly", s => s.get(key) as IDBRequest<SaveRecord | undefined>);
      if (!rec) throw new Error(`Save not found: ${name}`);
      return rec.data;
    },
    async write(kind, name, data) {
      const key = `${kind}:${name}`;
      const rec: SaveRecord = {
        key,
        name,
        kind,
        savedAt: new Date().toISOString(),
        data,
      };
      await tx("readwrite", s => s.put(rec));
    },
    async remove(kind, name) {
      const key = `${kind}:${name}`;
      await tx("readwrite", s => s.delete(key));
    },
  };
}

export function getSaveStorage(): SaveStorage {
  return indexedDbStorage();
}
