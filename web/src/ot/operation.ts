/**
 * Operational transformation over UTF-8 text — the TypeScript half.
 *
 * This is a deliberate mirror of internal/ot in Go, down to the tie-breaking
 * rule in transform(). The two are kept honest by testdata/ot-vectors.json,
 * which is generated from the Go engine and replayed here: if they ever drift,
 * two clients would converge to different documents and nothing would report it.
 *
 * All lengths and offsets are UTF-8 byte counts. See PLAN.md §3.2.
 */

import { utf8Length, utf8Slice, utf8Encode, isBoundary } from "./utf8";

export type Op =
  | { readonly kind: "retain"; n: number }
  | { readonly kind: "insert"; s: string }
  | { readonly kind: "delete"; n: number };

/** The ot.js wire format: positive = retain, negative = delete, string = insert. */
export type WireOp = number | string;

export class OTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OTError";
  }
}

export function opLength(op: Op): number {
  return op.kind === "insert" ? utf8Length(op.s) : op.n;
}

export class OpSeq {
  readonly ops: Op[] = [];
  private base = 0;
  private target = 0;

  get baseLength(): number {
    return this.base;
  }

  get targetLength(): number {
    return this.target;
  }

  get isNoop(): boolean {
    return this.ops.length === 0 || (this.ops.length === 1 && this.ops[0]!.kind === "retain");
  }

  /** Advance over n bytes unchanged. Non-positive n is ignored. */
  retain(n: number): this {
    if (n <= 0) return this;
    this.base += n;
    this.target += n;
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === "retain") {
      last.n += n;
    } else {
      this.ops.push({ kind: "retain", n });
    }
    return this;
  }

  /** Remove n bytes. The sign is ignored so wire values can be passed through. */
  delete(n: number): this {
    const count = Math.abs(n);
    if (count === 0) return this;
    this.base += count;
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === "delete") {
      last.n += count;
    } else {
      this.ops.push({ kind: "delete", n: count });
    }
    return this;
  }

  /**
   * Insert text at the current position.
   *
   * Insert and delete commute, so we always normalise to insert-first. Two
   * equivalent operations then encode identically, which is what makes the
   * shared golden vectors meaningful. The Go engine does exactly the same.
   */
  insert(s: string): this {
    if (s === "") return this;
    this.target += utf8Length(s);

    const n = this.ops.length;
    const last = this.ops[n - 1];
    const beforeLast = this.ops[n - 2];

    if (last?.kind === "insert") {
      last.s += s;
    } else if (last?.kind === "delete") {
      if (beforeLast?.kind === "insert") {
        beforeLast.s += s;
      } else {
        // Shift the delete right and slot the insert in front of it.
        this.ops.push(last);
        this.ops[n - 1] = { kind: "insert", s };
      }
    } else {
      this.ops.push({ kind: "insert", s });
    }
    return this;
  }

  /** Apply to a document, returning the result. */
  apply(doc: string): string {
    const bytes = utf8Encode(doc);
    if (bytes.length !== this.base) {
      throw new OTError(
        `operation expects ${this.base} bytes, document has ${bytes.length}`,
      );
    }

    const parts: string[] = [];
    let i = 0;
    for (const op of this.ops) {
      switch (op.kind) {
        case "retain": {
          const end = i + op.n;
          if (!isBoundary(bytes, end)) {
            throw new OTError(`retain boundary at byte ${end} splits a character`);
          }
          parts.push(utf8Slice(doc, i, end));
          i = end;
          break;
        }
        case "delete": {
          const end = i + op.n;
          if (!isBoundary(bytes, end)) {
            throw new OTError(`delete boundary at byte ${end} splits a character`);
          }
          i = end;
          break;
        }
        case "insert":
          parts.push(op.s);
          break;
      }
    }
    return parts.join("");
  }

  /** The operation that undoes this one, given the document it applied to. */
  invert(doc: string): OpSeq {
    const inv = new OpSeq();
    let i = 0;
    for (const op of this.ops) {
      switch (op.kind) {
        case "retain":
          inv.retain(op.n);
          i += op.n;
          break;
        case "insert":
          inv.delete(utf8Length(op.s));
          break;
        case "delete":
          inv.insert(utf8Slice(doc, i, i + op.n));
          i += op.n;
          break;
      }
    }
    return inv;
  }

  /**
   * Map a byte position through this operation.
   *
   * Text deleted out from under a position collapses it to the start of the
   * deleted range — what an editor does when the line you were on disappears.
   */
  transformIndex(pos: number): number {
    if (pos < 0) return 0;
    let remaining = pos;
    let out = pos;
    for (const op of this.ops) {
      switch (op.kind) {
        case "retain":
          remaining -= op.n;
          break;
        case "insert":
          out += utf8Length(op.s);
          break;
        case "delete":
          out -= Math.min(remaining, op.n);
          remaining -= op.n;
          break;
      }
      if (remaining < 0) break;
    }
    return out < 0 ? 0 : out;
  }

  transformRange(start: number, end: number): [number, number] {
    const a = this.transformIndex(start);
    const b = this.transformIndex(end);
    return a > b ? [b, a] : [a, b];
  }

  toJSON(): WireOp[] {
    return this.ops.map((op) => {
      switch (op.kind) {
        case "retain":
          return op.n;
        case "delete":
          return -op.n;
        case "insert":
          return op.s;
      }
    });
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  static fromJSON(raw: unknown): OpSeq {
    if (!Array.isArray(raw)) {
      throw new OTError("operation must be an array");
    }
    const seq = new OpSeq();
    raw.forEach((item, i) => {
      if (typeof item === "string") {
        seq.insert(item);
      } else if (typeof item === "number" && Number.isInteger(item)) {
        if (item > 0) seq.retain(item);
        else if (item < 0) seq.delete(-item);
        else throw new OTError(`zero-length component at index ${i}`);
      } else {
        throw new OTError(`invalid component at index ${i}`);
      }
    });
    return seq;
  }
}

/**
 * Walks a component list, allowing the head to be consumed in pieces.
 *
 * Each component is cloned on the way out. Go's iterator holds a value copy for
 * free; here the ops are objects, and consuming a shared reference would mutate
 * the operation being transformed — corrupting the caller's data in a way that
 * only shows up on the second use of an operation.
 */
export class Iter {
  private i = 0;
  cur: Op | undefined;

  constructor(private readonly ops: readonly Op[]) {
    this.advance();
  }

  get ok(): boolean {
    return this.cur !== undefined;
  }

  advance(): void {
    const next = this.ops[this.i++];
    this.cur = next ? { ...next } : undefined;
  }

  /** Consume n bytes from a retain or delete head. */
  takeN(n: number): void {
    const cur = this.cur as { kind: "retain" | "delete"; n: number };
    cur.n -= n;
    if (cur.n <= 0) this.advance();
  }

  /** Consume n bytes from an insert head and return them. */
  takeS(n: number): string {
    const cur = this.cur as { kind: "insert"; s: string };
    const head = utf8Slice(cur.s, 0, n);
    cur.s = utf8Slice(cur.s, n);
    if (cur.s === "") this.advance();
    return head;
  }
}
