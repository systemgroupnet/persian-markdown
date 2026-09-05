import { Iter, OpSeq, OTError, opLength } from "./operation";

/**
 * Resolve two operations made concurrently against the same document.
 *
 * Returns [aPrime, bPrime] such that compose(a, bPrime) ≡ compose(b, aPrime) —
 * the TP1 property. It is what lets two people type in the same paragraph and
 * still end up with byte-identical documents.
 *
 * Note the asymmetry in the insert/insert case: when both sides insert at the
 * same position there is no correct answer, only a consistent one, so a's
 * insert always goes first. The Go engine applies the same rule, and
 * testdata/ot-vectors.json is what proves the two still agree.
 */
export function transform(a: OpSeq, b: OpSeq): [OpSeq, OpSeq] {
  if (a.baseLength !== b.baseLength) {
    throw new OTError(
      `cannot transform: base lengths ${a.baseLength} and ${b.baseLength} differ`,
    );
  }

  const aPrime = new OpSeq();
  const bPrime = new OpSeq();
  const ia = new Iter(a.ops);
  const ib = new Iter(b.ops);

  while (ia.ok || ib.ok) {
    if (ia.cur?.kind === "insert") {
      aPrime.insert(ia.cur.s);
      bPrime.retain(opLength(ia.cur));
      ia.advance();
      continue;
    }
    if (ib.cur?.kind === "insert") {
      aPrime.retain(opLength(ib.cur));
      bPrime.insert(ib.cur.s);
      ib.advance();
      continue;
    }
    if (!ia.cur || !ib.cur) {
      throw new OTError("ran out of components while transforming");
    }

    const av = ia.cur;
    const bv = ib.cur;

    if (av.kind === "retain" && bv.kind === "retain") {
      const n = Math.min(av.n, bv.n);
      aPrime.retain(n);
      bPrime.retain(n);
      ia.takeN(n);
      ib.takeN(n);
    } else if (av.kind === "delete" && bv.kind === "delete") {
      // Both peers deleted the same bytes; the text is already gone, so
      // neither transformed operation should delete it a second time.
      const n = Math.min(av.n, bv.n);
      ia.takeN(n);
      ib.takeN(n);
    } else if (av.kind === "delete" && bv.kind === "retain") {
      const n = Math.min(av.n, bv.n);
      aPrime.delete(n);
      ia.takeN(n);
      ib.takeN(n);
    } else if (av.kind === "retain" && bv.kind === "delete") {
      const n = Math.min(av.n, bv.n);
      bPrime.delete(n);
      ia.takeN(n);
      ib.takeN(n);
    } else {
      throw new OTError(`cannot transform ${av.kind} against ${bv.kind}`);
    }
  }

  return [aPrime, bPrime];
}
