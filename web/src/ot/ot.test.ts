import { describe, expect, it } from "vitest";

import { OpSeq, OTError } from "./operation";
import { compose } from "./compose";
import { transform } from "./transform";
import { utf8Length, utf8Encode } from "./utf8";

const ZWNJ = "‌";

/** Mixed byte widths, so generated operations exercise real boundaries. */
const ALPHABET = [
  "س", "ل", "ا", "م", "ی", // Persian, 2 bytes
  ZWNJ,                     // 3 bytes, appears inside words
  "א", "ב",                 // Hebrew, 2 bytes
  "न", "म",                 // Devanagari, 3 bytes
  "😀",                      // 4 bytes
  "a", "Z", "7",            // 1 byte
  " ", "\n", "#", "*", "`", // markdown structure
];

/** Deterministic RNG: a failure must be reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

function randomText(rng: () => number): string {
  let s = "";
  for (let n = 1 + randInt(rng, 6); n > 0; n--) s += ALPHABET[randInt(rng, ALPHABET.length)]!;
  return s;
}

function randomDoc(rng: () => number): string {
  let s = "";
  for (let n = randInt(rng, 24); n > 0; n--) s += ALPHABET[randInt(rng, ALPHABET.length)]!;
  return s;
}

/** Build a valid operation over doc, always splitting at character boundaries. */
function randomOp(rng: () => number, doc: string): OpSeq {
  const chars = Array.from(doc);
  const op = new OpSeq();
  let i = 0;
  while (i < chars.length) {
    if (randInt(rng, 3) === 0) op.insert(randomText(rng));
    const n = 1 + randInt(rng, chars.length - i);
    const width = utf8Length(chars.slice(i, i + n).join(""));
    if (randInt(rng, 2) === 0) op.retain(width);
    else op.delete(width);
    i += n;
  }
  if (randInt(rng, 3) === 0) op.insert(randomText(rng));
  return op;
}

const ITERATIONS = 5000;

describe("OpSeq", () => {
  it("normalises insert ahead of delete", () => {
    const a = new OpSeq().delete(3).insert("x");
    const b = new OpSeq().insert("x").delete(3);
    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('["x",-3]');
  });

  it("applies Persian edits by byte offset", () => {
    expect(new OpSeq().retain(8).insert(" دنیا").apply("سلام")).toBe("سلام دنیا");
    // ZWNJ is 3 bytes at offset 4 of "میروم"
    expect(new OpSeq().retain(4).insert(ZWNJ).retain(6).apply("میروم")).toBe("می‌روم");
  });

  it("rejects a wrong base length", () => {
    expect(() => new OpSeq().retain(5).apply("سلام")).toThrow(OTError);
  });

  it("rejects a boundary that splits a character", () => {
    // "سلام" is four 2-byte characters; retaining 1 byte lands mid-character.
    expect(() => new OpSeq().retain(1).delete(7).apply("سلام")).toThrow();
  });

  it("rejects a boundary that splits a ZWNJ", () => {
    const doc = "می‌روم";
    expect(utf8Encode(doc).length).toBe(13);
    for (const off of [5, 6]) {
      expect(() => new OpSeq().retain(off).delete(13 - off).apply(doc)).toThrow();
    }
  });

  it("maps cursor positions through an operation", () => {
    const insert = new OpSeq().retain(2).insert("xy").retain(2);
    expect(insert.transformIndex(1)).toBe(1);
    expect(insert.transformIndex(2)).toBe(4);
    expect(insert.transformIndex(3)).toBe(5);

    const del = new OpSeq().retain(2).delete(3).retain(2);
    expect(del.transformIndex(1)).toBe(1);
    expect(del.transformIndex(4)).toBe(2); // inside the deletion, collapses
    expect(del.transformIndex(6)).toBe(3);
  });

  it("round-trips through the wire format", () => {
    const op = new OpSeq().retain(4).insert("سلام" + ZWNJ).delete(6).retain(2);
    const back = OpSeq.fromJSON(JSON.parse(op.toString()));
    expect(back.toString()).toBe(op.toString());
    expect(back.baseLength).toBe(op.baseLength);
    expect(back.targetLength).toBe(op.targetLength);
  });

  it("rejects malformed wire input", () => {
    for (const bad of [[0], [{}], [1, true], [1, [2]], ["a", 0.5]]) {
      expect(() => OpSeq.fromJSON(bad), JSON.stringify(bad)).toThrow(OTError);
    }
    expect(() => OpSeq.fromJSON(5)).toThrow(OTError);
  });
});

describe("properties", () => {
  it("converges for concurrent operations (TP1)", () => {
    const rng = mulberry32(20260905);
    for (let i = 0; i < ITERATIONS; i++) {
      const doc = randomDoc(rng);
      const a = randomOp(rng, doc);
      const b = randomOp(rng, doc);

      const [aPrime, bPrime] = transform(a, b);
      const x = compose(a, bPrime).apply(doc);
      const y = compose(b, aPrime).apply(doc);

      expect(x, `divergence on doc ${JSON.stringify(doc)} a=${a} b=${b}`).toBe(y);
      // The transformed operation must also work applied on top of the other
      // peer's document, which is how the client actually uses it.
      expect(bPrime.apply(a.apply(doc))).toBe(x);
    }
  });

  it("composes equivalently to applying in sequence", () => {
    const rng = mulberry32(3141592);
    for (let i = 0; i < ITERATIONS; i++) {
      const doc = randomDoc(rng);
      const a = randomOp(rng, doc);
      const mid = a.apply(doc);
      const b = randomOp(rng, mid);
      expect(compose(a, b).apply(doc)).toBe(b.apply(mid));
    }
  });

  it("inverts back to the original document", () => {
    const rng = mulberry32(2718281);
    for (let i = 0; i < ITERATIONS; i++) {
      const doc = randomDoc(rng);
      const op = randomOp(rng, doc);
      expect(op.invert(doc).apply(op.apply(doc))).toBe(doc);
    }
  });
});
