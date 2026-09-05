/**
 * Shared scaffolding for collab tests. Not a test file itself (vitest only
 * picks up `*.test.ts`), so it is safe to import from both client.test.ts and
 * session.test.ts without running twice.
 */

import { OpSeq, transform, utf8Length } from "../ot";

// ---------------------------------------------------------------------------
// Deterministic RNG — a failure must be reproducible.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/**
 * Byte widths mixed deliberately (PLAN.md §3.2 test corpus): Persian and
 * Hebrew are 2 bytes, ZWNJ (appears inside "می‌روم") is 3, the emoji is 4 —
 * byte offsets and character counts diverge on almost every edit, which is
 * exactly the bug class this whole test file exists to catch.
 */
const ZWNJ = "‌";
export const ALPHABET = [
  "س", "ل", "ا", "م", "ی", // Persian, 2 bytes
  ZWNJ, // 3 bytes, appears inside ordinary words: می‌روم
  "א", "ב", "ש", // Hebrew, 2 bytes
  "😀", "🎉", // 4 bytes
  "a", "b", "Z", "7",
  " ", "\n", "#", "*", "`",
];

export function randomText(rng: () => number, maxLen = 6): string {
  let s = "";
  const n = 1 + randInt(rng, maxLen);
  for (let i = 0; i < n; i++) s += ALPHABET[randInt(rng, ALPHABET.length)]!;
  return s;
}

export function randomDoc(rng: () => number, maxLen = 24): string {
  let s = "";
  const n = randInt(rng, maxLen);
  for (let i = 0; i < n; i++) s += ALPHABET[randInt(rng, ALPHABET.length)]!;
  return s;
}

/**
 * Build a valid operation over `doc`, always splitting at Unicode code-point
 * boundaries (so retains/deletes are never rejected for splitting a
 * character) but expressed — like every OpSeq — in byte lengths.
 */
export function randomOp(rng: () => number, doc: string): OpSeq {
  const chars = Array.from(doc);
  const op = new OpSeq();
  let i = 0;
  while (i < chars.length) {
    if (randInt(rng, 4) === 0) op.insert(randomText(rng));
    const n = 1 + randInt(rng, chars.length - i);
    const width = utf8Length(chars.slice(i, i + n).join(""));
    if (randInt(rng, 2) === 0) op.retain(width);
    else op.delete(width);
    i += n;
  }
  if (randInt(rng, 4) === 0) op.insert(randomText(rng));
  return op;
}

// ---------------------------------------------------------------------------
// A minimal in-memory server that rebases edits exactly as
// internal/room/room.go's ApplyEdit does — so convergence tests exercise the
// real rebase algorithm, not a hand-wavy stand-in for it.
// ---------------------------------------------------------------------------

export interface ServerOp {
  id: number;
  operation: OpSeq;
}

export class FakeServer {
  text = "";
  ops: ServerOp[] = [];

  /** Mirrors Room.ApplyEdit: rebase across everything since `revision`, apply, append. */
  applyEdit(userId: number, revision: number, op: OpSeq): OpSeq {
    if (revision < 0 || revision > this.ops.length) {
      throw new Error(`FakeServer: revision ${revision} out of range (room at ${this.ops.length})`);
    }
    let transformed = op;
    for (let i = revision; i < this.ops.length; i++) {
      const [a] = transform(transformed, this.ops[i]!.operation);
      transformed = a;
    }
    this.text = transformed.apply(this.text);
    this.ops.push({ id: userId, operation: transformed });
    return transformed;
  }

  /** Mirrors Room.HistorySince. */
  historySince(revision: number): { start: number; operations: ServerOp[] } {
    const rev = revision < 0 ? 0 : revision;
    if (rev >= this.ops.length) return { start: this.ops.length, operations: [] };
    return { start: rev, operations: this.ops.slice(rev) };
  }
}

// ---------------------------------------------------------------------------
// A time-ordered event queue standing in for "the network": every send gets
// a random delay, so messages from different clients (and the server's
// broadcasts back to them) arrive out of send order — the "randomly delayed
// / reordered delivery" the convergence test is required to exercise.
// ---------------------------------------------------------------------------

interface QueuedEvent {
  time: number;
  seq: number;
  run: () => void;
}

export class NetworkQueue {
  private events: QueuedEvent[] = [];
  private seq = 0;
  private clock = 0;

  constructor(private readonly rng: () => number, private readonly maxDelay = 8) {}

  /** Schedule `run` after a random 1..maxDelay tick delay from the current simulated time. */
  schedule(run: () => void): void {
    const delay = 1 + randInt(this.rng, this.maxDelay);
    const time = this.clock + delay;
    const seq = this.seq++;
    // Sorted insert; event volumes in these tests are small enough that this
    // being O(n) per insert does not matter.
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const e = this.events[mid]!;
      if (e.time < time || (e.time === time && e.seq < seq)) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, { time, seq, run });
  }

  /** Run every event to completion, including ones scheduled while draining. */
  drain(): void {
    let guard = 0;
    while (this.events.length > 0) {
      const next = this.events.shift()!;
      this.clock = next.time;
      next.run();
      if (++guard > 2_000_000) throw new Error("NetworkQueue.drain: exceeded guard, likely an infinite loop");
    }
  }
}
