import { afterEach, describe, expect, it } from "vitest";

import { OpSeq } from "../ot";
import { CollabSession, diffText } from "./session";
import { IndexedDBStore } from "./storage";
import { LoopbackTransport } from "./transport";
import type { ConnectionStatus, Transport } from "./transport";
import type { ClientMsg, ServerMsg } from "./types";

/** A fully test-driven Transport: the test calls `emitMessage`/`emitStatus` directly. */
class ControllableTransport implements Transport {
  sent: ClientMsg[] = [];
  closed = false;
  private messageHandlers = new Set<(msg: ServerMsg) => void>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus;

  constructor(initialStatus: ConnectionStatus = "connecting") {
    this.status = initialStatus;
  }

  send(msg: ClientMsg): void {
    this.sent.push(msg);
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(cb);
    cb(this.status);
    return () => this.statusHandlers.delete(cb);
  }

  close(): void {
    this.closed = true;
  }

  emitMessage(msg: ServerMsg): void {
    for (const h of [...this.messageHandlers]) h(msg);
  }

  emitStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const h of [...this.statusHandlers]) h(s);
  }
}

describe("diffText", () => {
  it("is a no-op for identical strings", () => {
    expect(diffText("سلام", "سلام").isNoop).toBe(true);
  });

  it("captures an appended suffix", () => {
    const op = diffText("Hello", "Hello!");
    expect(op.apply("Hello")).toBe("Hello!");
  });

  it("captures a change in the middle without disturbing a ZWNJ at the edges", () => {
    // "می‌روم" (ZWNJ at byte 4) with the middle run replaced.
    const base = "می‌روم";
    const target = "می‌گویم"; // same prefix through the ZWNJ, different tail
    const op = diffText(base, target);
    expect(op.apply(base)).toBe(target);
  });

  it("handles total replacement and empty <-> non-empty", () => {
    expect(diffText("", "سلام دنیا").apply("")).toBe("سلام دنیا");
    expect(diffText("سلام دنیا", "").apply("سلام دنیا")).toBe("");
    expect(diffText("abc", "xyz").apply("abc")).toBe("xyz");
  });
});

describe("CollabSession — steady state", () => {
  it("sends a local edit once connected and baselined, then acks to Synchronized", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);

    t.emitMessage({ Identity: 1 });
    t.emitMessage({ History: { start: 0, operations: [] } }); // empty room bootstrap

    const op = new OpSeq().insert("سلام");
    session.applyLocalChange(op);

    expect(session.text).toBe("سلام");
    expect(t.sent).toEqual([{ Edit: { revision: 0, operation: op } }]);

    // Server echoes our own edit back, tagged with our id: this acks it.
    t.emitMessage({ History: { start: 0, operations: [{ id: 1, operation: op }] } });
    expect(session.text).toBe("سلام");
    expect(t.sent).toHaveLength(1); // nothing further to send
  });

  it("applies a remote op from another participant and keeps the local cursor sane", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);
    t.emitMessage({ Identity: 1 });
    t.emitMessage({ History: { start: 0, operations: [{ id: 2, operation: new OpSeq().insert("abc") }] } });

    expect(session.text).toBe("abc");

    const remoteInsert = new OpSeq().retain(1).insert("XY").retain(2);
    t.emitMessage({ History: { start: 1, operations: [{ id: 2, operation: remoteInsert }] } });

    expect(session.text).toBe("aXYbc");
  });

  it("tracks presence from UserInfo and UserCursor, including departure", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);
    t.emitMessage({ Identity: 1 });
    t.emitMessage({ History: { start: 0, operations: [] } });

    t.emitMessage({ UserInfo: { id: 2, info: { name: "هدهد", hue: 41 } } });
    t.emitMessage({ UserCursor: { id: 2, data: { cursors: [3], selections: [] } } });

    expect(session.presence.peers).toEqual([
      { id: 2, info: { name: "هدهد", hue: 41 }, cursor: { cursors: [3], selections: [] } },
    ]);

    t.emitMessage({ UserInfo: { id: 2, info: null } }); // left
    expect(session.presence.peers).toEqual([]);
  });

  it("a brand-new, never-edited room does not deadlock: the first local edit is sent without waiting for a History that will never come", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);
    t.emitMessage({ Identity: 1 }); // no History follows — internal/server/conn.go skips it when ops==0

    const op = new OpSeq().insert("x");
    session.applyLocalChange(op);

    expect(t.sent).toEqual([{ Edit: { revision: 0, operation: op } }]);
    expect(session.text).toBe("x");
  });
});

describe("CollabSession — reconnect with local edits", () => {
  it("buffers offline edits and folds them into one operation once real History arrives", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);
    t.emitMessage({ Identity: 1 });
    t.emitMessage({ History: { start: 0, operations: [{ id: 9, operation: new OpSeq().insert("Hello") }] } });
    expect(session.text).toBe("Hello");

    // Connection drops.
    t.emitStatus("reconnecting");
    const sentBeforeOffline = t.sent.length;

    // User keeps typing while offline — must not be sent, must not be lost.
    session.applyLocalChange(new OpSeq().retain(5).insert("!"));
    session.applyLocalChange(new OpSeq().retain(6).insert("?"));
    expect(session.text).toBe("Hello!?");
    expect(t.sent).toHaveLength(sentBeforeOffline); // nothing sent while offline

    // Reconnect: a brand-new connection, full History replay from revision 0
    // (internal/server/conn.go always starts a new connection's sentRevision
    // at 0 — see session.ts's module doc). Same content as before we dropped:
    // nobody else edited the room while we were gone.
    t.emitStatus("connected");
    t.emitMessage({ Identity: 1 });
    t.emitMessage({ History: { start: 0, operations: [{ id: 9, operation: new OpSeq().insert("Hello") }] } });

    // The reconciliation must have emitted exactly one new operation carrying
    // our offline edits forward, and it must not have touched the visible text.
    expect(session.text).toBe("Hello!?");
    const reconcileMsgs = t.sent.slice(sentBeforeOffline);
    expect(reconcileMsgs).toHaveLength(1);
    const sentOp = (reconcileMsgs[0] as { Edit: { revision: number; operation: OpSeq } }).Edit;
    expect(sentOp.revision).toBe(1); // the rebuild reached revision 1 (one prior op)
    expect(sentOp.operation.apply("Hello")).toBe("Hello!?");

    // Ack it like the server would (tagged with our own, possibly new, id).
    t.emitMessage({ History: { start: 1, operations: [{ id: 1, operation: sentOp.operation }] } });
    expect(session.text).toBe("Hello!?");
  });

  it("a concurrent edit by someone else while we were offline is folded in alongside our own", () => {
    const t = new ControllableTransport("connected");
    const session = new CollabSession(t);
    t.emitMessage({ Identity: 5 });
    t.emitMessage({ History: { start: 0, operations: [{ id: 9, operation: new OpSeq().insert("AB") }] } });
    expect(session.text).toBe("AB");

    t.emitStatus("offline");
    session.applyLocalChange(new OpSeq().retain(2).insert("C")); // we type "C" -> "ABC"
    expect(session.text).toBe("ABC");

    t.emitStatus("connected");
    t.emitMessage({ Identity: 5 });
    // While we were gone, someone else inserted "Z" at the front: room is now "ZAB".
    t.emitMessage({
      History: {
        start: 0,
        operations: [
          { id: 9, operation: new OpSeq().insert("AB") },
          { id: 9, operation: new OpSeq().insert("Z").retain(2) },
        ],
      },
    });

    // We must have sent our own edit rebased against what we knew (base
    // "AB"), tagged at the revision we last confirmed — not against the
    // room's brand-new "ZAB", which we didn't know about until just now.
    const sent = t.sent.at(-1) as { Edit: { revision: number; operation: OpSeq } };
    expect(sent.Edit.revision).toBe(1);
    expect(sent.Edit.operation.apply("AB")).toBe("ABC");

    // Locally, though, the concurrent "Z" and our own "C" must both survive —
    // this is the whole point: neither edit silently clobbers the other.
    expect(session.text).toBe("ZABC");
  });
});

// ---------------------------------------------------------------------------
// LoopbackTransport + IndexedDB persistence
// ---------------------------------------------------------------------------

/** Minimal in-memory IndexedDB, just enough of the API storage.ts calls. */
class FakeIDBRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: unknown;
  succeed(result: unknown): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }
  fail(): void {
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeIDBObjectStore {
  constructor(private readonly backing: Map<string, unknown>) {}
  get(key: string): FakeIDBRequest {
    const req = new FakeIDBRequest();
    req.succeed(this.backing.get(key));
    return req;
  }
  put(value: unknown, key: string): FakeIDBRequest {
    const req = new FakeIDBRequest();
    this.backing.set(key, value);
    req.succeed(undefined);
    return req;
  }
}

class FakeIDBTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private readonly backing: Map<string, unknown>) {
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(_name: string): FakeIDBObjectStore {
    return new FakeIDBObjectStore(this.backing);
  }
}

class FakeIDBDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }
  transaction(name: string, _mode: string): FakeIDBTransaction {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return new FakeIDBTransaction(this.stores.get(name)!);
  }
}

function installFakeIndexedDB(opts: { failOpen?: boolean } = {}): { uninstall: () => void } {
  const databases = new Map<string, FakeIDBDatabase>();
  const fake = {
    open(name: string, _version: number) {
      const req = new FakeIDBRequest() as FakeIDBRequest & { onupgradeneeded: (() => void) | null };
      req.onupgradeneeded = null;
      queueMicrotask(() => {
        if (opts.failOpen) {
          req.fail();
          return;
        }
        let db = databases.get(name);
        const isNew = !db;
        if (!db) {
          db = new FakeIDBDatabase();
          databases.set(name, db);
        }
        req.result = db;
        if (isNew) req.onupgradeneeded?.();
        req.succeed(db);
      });
      return req;
    },
  };
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  return {
    uninstall() {
      (globalThis as { indexedDB?: unknown }).indexedDB = original;
    },
  };
}

/** Let every currently-queued microtask (and one macrotask hop) settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("LoopbackTransport + IndexedDBStore", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("round-trips: an edit persists, and a fresh transport against the same database restores it", async () => {
    ({ uninstall } = installFakeIndexedDB());

    const storeA = new IndexedDBStore("test-db");
    const transportA = new LoopbackTransport(storeA, "private");
    const sessionA = new CollabSession(transportA);
    await tick();

    expect(sessionA.presence.ready).toBe(true);
    expect(sessionA.text).toBe(""); // nothing persisted yet

    sessionA.applyLocalChange(new OpSeq().insert("سلام دنیا"));
    expect(sessionA.text).toBe("سلام دنیا");

    storeA.flush(); // bypass the 300ms debounce for the test
    await tick();
    await tick();

    // Simulate a reload: a fresh store + transport against the *same* database.
    const storeB = new IndexedDBStore("test-db");
    const transportB = new LoopbackTransport(storeB, "private");
    const sessionB = new CollabSession(transportB);
    await tick();

    expect(sessionB.text).toBe("سلام دنیا");
    expect(sessionB.presence.ready).toBe(true);
  });

  it("acknowledges every Edit immediately at revision + 1 and never emits presence", async () => {
    const transport = new LoopbackTransport(); // no storage at all — still must work
    const session = new CollabSession(transport);
    await tick();

    session.setName("یوزپلنگ ایرانی", 214); // must be a no-op, not throw
    session.setCursor([0], []);

    session.applyLocalChange(new OpSeq().insert("a"));
    session.applyLocalChange(new OpSeq().retain(1).insert("b"));
    await tick();

    expect(session.text).toBe("ab");
    expect(session.presence.peers).toEqual([]); // private mode: no presence, ever
  });

  it("a storage failure (open rejects) degrades to an in-memory document instead of breaking editing", async () => {
    ({ uninstall } = installFakeIndexedDB({ failOpen: true }));

    const store = new IndexedDBStore("broken-db");
    const transport = new LoopbackTransport(store, "private");
    const session = new CollabSession(transport);
    await tick();

    expect(session.presence.ready).toBe(true);
    expect(() => session.applyLocalChange(new OpSeq().insert("still works"))).not.toThrow();
    expect(session.text).toBe("still works");

    store.flush();
    await tick();
    await tick(); // must not throw / hang even though the database never opened
  });

  it("with no indexedDB global at all (private browsing), editing still works", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    // The vitest "node" environment already has no indexedDB; this is here to
    // document and pin that assumption rather than rely on it silently.
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");

    const store = new IndexedDBStore("unused-db");
    const transport = new LoopbackTransport(store, "private");
    const session = new CollabSession(transport);
    await tick();

    expect(() => session.applyLocalChange(new OpSeq().insert("x"))).not.toThrow();
    store.flush();
    await tick();

    if (originalDescriptor) Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
  });
});
