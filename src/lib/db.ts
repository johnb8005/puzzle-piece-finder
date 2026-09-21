/**
 * Persistence: sessions live in IndexedDB (photos are Blobs, far too big for
 * localStorage), and the id of the session being worked on lives in
 * localStorage. Every call swallows storage failures (private windows, blocked
 * site data) so the app keeps working without persistence.
 */
import type { SessionRecord } from "./session";

const DB_NAME = "puzzle-piece-finder";
const DB_VERSION = 1;
const STORE = "sessions";
const CURRENT_KEY = "pf:current-session";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** All sessions, most recently updated first. Empty on any storage failure. */
export async function listSessions(): Promise<SessionRecord[]> {
  try {
    const all = await request((await store("readonly")).getAll());
    return (all as SessionRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function loadSession(id: string): Promise<SessionRecord | null> {
  try {
    return ((await request((await store("readonly")).get(id))) as SessionRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveSession(rec: SessionRecord): Promise<boolean> {
  try {
    await request((await store("readwrite")).put(rec));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await request((await store("readwrite")).delete(id));
  } catch {
    /* nothing to do */
  }
}

export function getCurrentSessionId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* private window or blocked storage */
  }
}
