import { Iter, OpSeq, OTError, opLength } from "./operation";

/**
 * A single operation equivalent to applying a and then b.
 *
 *   a.apply(b.apply(doc)) === compose(a, b).apply(doc)
 *
 * The client uses this to merge pending local edits into one outgoing
 * operation while it waits for the server to acknowledge the last one.
 */
export function compose(a: OpSeq, b: OpSeq): OpSeq {
  if (a.targetLength !== b.baseLength) {
    throw new OTError(
      `cannot compose: first produces ${a.targetLength} bytes, second expects ${b.baseLength}`,
    );
  }

  const out = new OpSeq();
  const ia = new Iter(a.ops);
  const ib = new Iter(b.ops);

  while (ia.ok || ib.ok) {
    // A delete in a happened before b existed, so it survives untouched.
    if (ia.cur?.kind === "delete") {
      out.delete(ia.cur.n);
      ia.advance();
      continue;
    }
    // An insert in b lands in the composed document unchanged.
    if (ib.cur?.kind === "insert") {
      out.insert(ib.cur.s);
      ib.advance();
      continue;
    }
    if (!ia.cur || !ib.cur) {
      throw new OTError("ran out of components while composing");
    }

    const av = ia.cur;
    const bv = ib.cur;

    if (av.kind === "retain" && bv.kind === "retain") {
      const n = Math.min(av.n, bv.n);
      out.retain(n);
      ia.takeN(n);
      ib.takeN(n);
    } else if (av.kind === "insert" && bv.kind === "delete") {
      // b deletes text a had just inserted: it never existed, emit nothing.
      const n = Math.min(opLength(av), bv.n);
      ia.takeS(n);
      ib.takeN(n);
    } else if (av.kind === "insert" && bv.kind === "retain") {
      const n = Math.min(opLength(av), bv.n);
      out.insert(ia.takeS(n));
      ib.takeN(n);
    } else if (av.kind === "retain" && bv.kind === "delete") {
      const n = Math.min(av.n, bv.n);
      out.delete(n);
      ia.takeN(n);
      ib.takeN(n);
    } else {
      throw new OTError(`cannot compose ${av.kind} with ${bv.kind}`);
    }
  }

  return out;
}
