import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OpSeq } from "./operation";
import { compose } from "./compose";
import { transform } from "./transform";

/**
 * The Go engine is the authority. These vectors are generated from it
 * (`go test ./internal/ot -run TestGoldenVectors -write-vectors`) and replayed
 * here, because a disagreement between the two implementations would show up
 * in production as two users watching the same document drift apart — with
 * nothing in either language's own test suite noticing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = resolve(here, "../../../testdata/ot-vectors.json");

type Wire = (number | string)[];

interface Vectors {
  note: string;
  unit: string;
  apply: { doc: string; op: Wire; want: string; note?: string }[];
  compose: { doc: string; a: Wire; b: Wire; want: string }[];
  transform: {
    doc: string;
    a: Wire;
    b: Wire;
    aPrime: Wire;
    bPrime: Wire;
    want: string;
  }[];
}

const vectors: Vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));

describe("golden vectors shared with the Go engine", () => {
  it("has all three sections", () => {
    expect(vectors.apply.length).toBeGreaterThan(0);
    expect(vectors.compose.length).toBeGreaterThan(0);
    expect(vectors.transform.length).toBeGreaterThan(0);
  });

  it("reproduces every apply case", () => {
    vectors.apply.forEach((c, i) => {
      const op = OpSeq.fromJSON(c.op);
      expect(op.apply(c.doc), `apply[${i}] ${c.note ?? ""}`).toBe(c.want);
    });
  });

  it("round-trips every operation through the wire format", () => {
    // Encoding must be stable in both directions, or the normalisation rules
    // (insert-before-delete) have drifted between the two engines.
    vectors.apply.forEach((c, i) => {
      const op = OpSeq.fromJSON(c.op);
      expect(op.toJSON(), `apply[${i}] re-encode`).toEqual(c.op);
    });
  });

  it("reproduces every compose case", () => {
    vectors.compose.forEach((c, i) => {
      const ab = compose(OpSeq.fromJSON(c.a), OpSeq.fromJSON(c.b));
      expect(ab.apply(c.doc), `compose[${i}]`).toBe(c.want);
    });
  });

  it("reproduces every transform case, operations included", () => {
    vectors.transform.forEach((c, i) => {
      const a = OpSeq.fromJSON(c.a);
      const b = OpSeq.fromJSON(c.b);
      const [aPrime, bPrime] = transform(a, b);

      // The transformed operations themselves are part of the contract: the
      // client applies b' directly, so an equivalent-but-differently-encoded
      // result is still a divergence risk.
      expect(aPrime.toJSON(), `transform[${i}] a'`).toEqual(c.aPrime);
      expect(bPrime.toJSON(), `transform[${i}] b'`).toEqual(c.bPrime);

      expect(compose(a, bPrime).apply(c.doc), `transform[${i}] result`).toBe(c.want);
      expect(compose(b, aPrime).apply(c.doc), `transform[${i}] convergence`).toBe(c.want);
    });
  });
});
