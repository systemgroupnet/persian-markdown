/**
 * IndexedDB persistence for the private document (PLAN.md §4.6).
 *
 * Raw IndexedDB, no library — the API is unpleasant but small, and this is
 * the only thing in the private-mode path that touches it. Every operation
 * must degrade to "the editor keeps working in memory" rather than throwing:
 * private browsing can refuse to open a database at all, storage can be
 * disabled by policy, and a write can fail on quota. None of those are this
 * module's problem to surface to the user — LoopbackTransport just treats a
 * `null` load as "no seed" and a failed save as "try again next debounce".
 *
 * Writes are debounced (~300ms) so a fast typist doesn't hammer IndexedDB on
 * every keystroke; `flush()` forces the pending write through immediately,
 * for use on `visibilitychange`/`beforeunload`.
 */

export interface DocumentStore {
  /** Resolves to the persisted text, or `null` if there is none / storage is unavailable. */
  load(id: string): Promise<string | null>;
  /** Debounced write; safe to call on every keystroke. */
  scheduleSave(id: string, text: string): void;
  /** Force any pending debounced writes through immediately. */
  flush(): void;
}

const DB_NAME = "persian-markdown";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const DEBOUNCE_MS = 300;

export class IndexedDBStore implements DocumentStore {
  private readonly dbPromise: Promise<IDBDatabase | null>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, string>();

  constructor(dbName: string = DB_NAME) {
    this.dbPromise = openDatabase(dbName);
  }

  async load(id: string): Promise<string | null> {
    const db = await this.dbPromise;
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  scheduleSave(id: string, text: string): void {
    this.pending.set(id, text);
    const existing = this.timers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(
      id,
      setTimeout(() => this.commit(id), DEBOUNCE_MS),
    );
  }

  flush(): void {
    for (const id of [...this.timers.keys()]) {
      clearTimeout(this.timers.get(id)!);
      this.commit(id);
    }
  }

  private commit(id: string): void {
    this.timers.delete(id);
    const text = this.pending.get(id);
    this.pending.delete(id);
    if (text === undefined) return;
    void this.write(id, text);
  }

  private async write(id: string, text: string): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return; // degrade silently: no storage, editor stays in-memory only

    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(text, id);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        // Quota exceeded, connection closing, etc. — all non-fatal to the caller.
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } catch {
      // Synchronous throws from a closed/invalid connection: same degrade-in-place rule.
    }
  }
}

function openDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null); // private browsing in some browsers, or a non-browser test environment
      return;
    }

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // onblocked (another tab holding an old version open) — degrade rather
    // than hang the editor waiting for a database that may never open.
    req.onblocked = () => resolve(null);
  });
}
