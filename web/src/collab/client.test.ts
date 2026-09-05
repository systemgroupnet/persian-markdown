import { describe, expect, it } from "vitest";

import { OpSeq, OTError } from "../ot";
import { OTClient, transformCursor } from "./client";
import { ALPHABET, FakeServer, NetworkQueue, mulberry32, randInt, randomOp } from "./testSupport";

describe("OTClient — explicit state transitions", () => {
  it("Synchronized -> AwaitingConfirm: applyClient sends immediately", () => {
    const c = new OTClient(5);
    expect(c.isSynchronized).toBe(true);

    const op = new OpSeq().insert("a");
    const sent = c.applyClient(op);

    expect(sent).toBe(op);
    expect(c.isSynchronized).toBe(false);
    expect(c.hasOutstanding).toBe(true);
    expect(c.revision).toBe(5); // applyClient never advances revision by itself
  });

  it("AwaitingConfirm -> AwaitingWithBuffer: a second local edit is buffered, not sent", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("a"));

    const second = new OpSeq().retain(1).insert("b");
    const sent = c.applyClient(second);

    expect(sent).toBeNull();
    expect(c.hasOutstanding).toBe(true);
  });

  it("AwaitingWithBuffer: further local edits compose into the same buffer", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("a")); // -> AwaitingConfirm("a")
    c.applyClient(new OpSeq().retain(1).insert("b")); // -> AwaitingWithBuffer("a", "ab" worth)
    const third = c.applyClient(new OpSeq().retain(2).insert("c"));

    expect(third).toBeNull(); // still not sent — outstanding still unacked

    // Confirm the buffer really did compose all three, by acking outstanding
    // and checking what gets sent: it should turn "a" into "abc" applied on
    // top of whatever the outstanding op already produced.
    const toSend = c.serverAck();
    expect(toSend).not.toBeNull();
    expect(toSend!.apply("a")).toBe("abc");
  });

  it("serverAck: AwaitingConfirm -> Synchronized, revision advances, nothing to send", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("x"));
    const toSend = c.serverAck();

    expect(toSend).toBeNull();
    expect(c.isSynchronized).toBe(true);
    expect(c.revision).toBe(1);
  });

  it("serverAck while buffering: sends the buffer and moves to AwaitingConfirm(buffer)", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("x")); // outstanding
    c.applyClient(new OpSeq().retain(1).insert("y")); // buffered

    const toSend = c.serverAck();
    expect(toSend).not.toBeNull();
    expect(c.isSynchronized).toBe(false); // now AwaitingConfirm(buffer) — one more ack owed
    expect(c.revision).toBe(1);

    const secondAck = c.serverAck();
    expect(secondAck).toBeNull();
    expect(c.isSynchronized).toBe(true);
    expect(c.revision).toBe(2);
  });

  it("serverAck with nothing outstanding throws", () => {
    const c = new OTClient(0);
    expect(() => c.serverAck()).toThrow(OTError);
  });

  it("applyServer in Synchronized: applies directly, stays Synchronized, revision advances", () => {
    const c = new OTClient(0);
    const remote = new OpSeq().insert("hi");
    const applied = c.applyServer(remote);

    expect(applied).toBe(remote);
    expect(c.isSynchronized).toBe(true);
    expect(c.revision).toBe(1);
  });

  it("applyServer in AwaitingConfirm: transforms outstanding, returns the op to apply locally", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("A")); // outstanding, against base ""

    // A concurrent remote insert, also against base "".
    const remote = new OpSeq().insert("B");
    const applied = c.applyServer(remote);

    // Tie-break: our own insert always precedes a concurrent one, so the
    // remote op is restated as landing *after* our (still unconfirmed) "A".
    expect(applied.apply("A")).toBe("AB");
    expect(c.revision).toBe(1);
    expect(c.isSynchronized).toBe(false);

    // Acking our outstanding now must reproduce the same document once
    // composed with what the remote side sees, which is the actual
    // convergence property (checked exhaustively below); here just confirm
    // the state machine let us get this far without throwing.
    expect(() => c.serverAck()).not.toThrow();
  });

  it("applyServer in AwaitingWithBuffer: transforms through outstanding then buffer", () => {
    const c = new OTClient(0);
    c.applyClient(new OpSeq().insert("A")); // outstanding
    c.applyClient(new OpSeq().retain(1).insert("C")); // buffer, local doc so far "AC"

    const remote = new OpSeq().insert("B"); // concurrent with the *original* outstanding op
    const applied = c.applyServer(remote);

    // Whatever the doubly-transformed op is, applying it to our local "AC"
    // must fold the remote edit in without losing anything we already typed.
    const localDoc = applied.apply("AC");
    expect(localDoc).toContain("A");
    expect(localDoc).toContain("B");
    expect(localDoc).toContain("C");
    expect(c.revision).toBe(1);
    expect(c.isSynchronized).toBe(false);
  });
});

describe("transformCursor", () => {
  it("shifts a cursor past an insertion", () => {
    const op = new OpSeq().retain(2).insert("xy").retain(2);
    const out = transformCursor({ cursors: [1, 2, 3], selections: [[0, 4]] }, op);
    expect(out.cursors).toEqual([1, 4, 5]);
    expect(out.selections).toEqual([[0, 6]]);
  });

  it("collapses a cursor caught inside a deletion", () => {
    const op = new OpSeq().retain(2).delete(3).retain(2);
    const out = transformCursor({ cursors: [3], selections: [] }, op);
    expect(out.cursors).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// Convergence: many clients, concurrent random edits, randomly delayed and
// reordered delivery, rebased by a server that implements the exact
// algorithm in internal/room/room.go's ApplyEdit.
// ---------------------------------------------------------------------------

interface InboxEntry {
  fromId: number;
  operation: OpSeq;
}

interface SimClient {
  id: number;
  otClient: OTClient;
  text: string;
  editsLeft: number;
  /** Broadcasts waiting to be delivered, strictly in server order. */
  inbox: InboxEntry[];
  pumpScheduled: boolean;
}

function runConvergenceScenario(
  seed: number,
  numClients: number,
  editsPerClient: number,
): { serverText: string; clients: SimClient[] } {
  const rng = mulberry32(seed);
  const server = new FakeServer();
  const queue = new NetworkQueue(rng, 8);

  const clients: SimClient[] = Array.from({ length: numClients }, (_, i) => ({
    id: i,
    otClient: new OTClient(0),
    text: "",
    editsLeft: editsPerClient,
    inbox: [],
    pumpScheduled: false,
  }));

  // A real per-connection transport (TCP under the WebSocket) delivers each
  // client's own message stream in order, even though delivery *latency*
  // varies and different clients' streams interleave arbitrarily relative to
  // each other. Modelling every broadcast with an independent random delay
  // would violate that — two ops racing to the same client could arrive in
  // an order the server never produced. So each client gets an inbox that is
  // strictly FIFO, "pumped" one entry at a time with a random delay between
  // steps: latency is random, order within one client's stream is not.
  function pump(c: SimClient): void {
    if (c.pumpScheduled || c.inbox.length === 0) return;
    c.pumpScheduled = true;
    queue.schedule(() => {
      c.pumpScheduled = false;
      const next = c.inbox.shift()!;
      deliver(c, next.fromId, next.operation);
      pump(c);
    });
  }

  const sendToServer = (c: SimClient, op: OpSeq): void => {
    const revision = c.otClient.revision;
    queue.schedule(() => {
      const transformed = server.applyEdit(c.id, revision, op);
      for (const other of clients) {
        other.inbox.push({ fromId: c.id, operation: transformed });
        pump(other);
      }
    });
  };

  function deliver(c: SimClient, fromId: number, operation: OpSeq): void {
    if (fromId === c.id) {
      const toSend = c.otClient.serverAck();
      if (toSend) sendToServer(c, toSend);
    } else {
      const applied = c.otClient.applyServer(operation);
      c.text = applied.apply(c.text);
    }
  }

  const scheduleLocalEdit = (c: SimClient): void => {
    queue.schedule(() => {
      if (c.editsLeft <= 0) return;
      c.editsLeft--;
      const op = randomOp(rng, c.text);
      c.text = op.apply(c.text);
      const toSend = c.otClient.applyClient(op);
      if (toSend) sendToServer(c, toSend);
      if (c.editsLeft > 0) scheduleLocalEdit(c);
    });
  };

  for (const c of clients) scheduleLocalEdit(c);
  queue.drain();

  return { serverText: server.text, clients };
}

describe("convergence under concurrent, reordered delivery", () => {
  const SCENARIOS: { seed: number; numClients: number; editsPerClient: number }[] = [];
  for (let s = 0; s < 24; s++) {
    SCENARIOS.push({
      seed: 1_000_003 * (s + 1) + 7,
      numClients: 2 + (s % 5), // 2..6 clients
      editsPerClient: 10 + (s % 4) * 10, // 10..40 edits each
    });
  }

  it.each(SCENARIOS)(
    "seed=$seed clients=$numClients edits=$editsPerClient converge to one document",
    ({ seed, numClients, editsPerClient }) => {
      const { serverText, clients } = runConvergenceScenario(seed, numClients, editsPerClient);

      for (const c of clients) {
        expect(c.otClient.isSynchronized, `client ${c.id} left with unacked edits`).toBe(true);
        expect(c.text, `client ${c.id} diverged from the server`).toBe(serverText);
      }
      // Every client also agrees with every other client, not just the server.
      for (let i = 1; i < clients.length; i++) {
        expect(clients[i]!.text).toBe(clients[0]!.text);
      }
    },
  );

  it("the alphabet actually produced ZWNJ, Hebrew and 4-byte emoji during the run", () => {
    // Guards against the corpus silently degenerating (e.g. a refactor that
    // narrows ALPHABET) into something that never exercises the byte-width
    // divergence this whole suite is protecting against.
    const rng = mulberry32(42);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(ALPHABET[randInt(rng, ALPHABET.length)]!);
    expect(seen.has("‌")).toBe(true); // ZWNJ
    expect(seen.has("א")).toBe(true); // Hebrew
    expect(seen.has("😀")).toBe(true); // 4-byte emoji
  });
});
