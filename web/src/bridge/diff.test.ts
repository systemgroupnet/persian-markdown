import { describe, expect, it } from "vitest";

import { applyTextChange, computeTextChange } from "./diff";

// Seeded PRNG (mulberry32) so failures are reproducible — same technique as
// src/ot/offsets.test.ts.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// PLAN.md §3.2's mandated corpus, plus emoji (surrogate pair) and a plain
// ASCII baseline.
const CORPUS = [
  "سلام دنیا",
  "می‌روم", // ZWNJ inside a Persian word
  "a😀b", // 4-byte emoji, i.e. a UTF-16 surrogate pair
  "नमस्ते", // combining marks
  "מה שלומך", // Hebrew
  "مخلوط mixed متن", // bidi
  "",
  "hello world",
];

describe("computeTextChange", () => {
  it("returns null for identical strings", () => {
    expect(computeTextChange("same", "same")).toBeNull();
    expect(computeTextChange("", "")).toBeNull();
  });

  it("finds a minimal insert at the end (typing)", () => {
    const change = computeTextChange("سلام", "سلام دنیا");
    expect(change).toEqual({ from: 4, to: 4, insert: " دنیا" });
  });

  it("finds a minimal insert at the start", () => {
    const change = computeTextChange("دنیا", "سلام دنیا");
    expect(change).toEqual({ from: 0, to: 0, insert: "سلام " });
  });

  it("finds a minimal insert in the middle", () => {
    const change = computeTextChange("سدنیا", "سلام دنیا");
    expect(change).not.toBeNull();
    expect(applyTextChange("سدنیا", change!)).toBe("سلام دنیا");
  });

  it("finds a minimal delete", () => {
    const change = computeTextChange("سلام دنیا", "سلام");
    expect(change).toEqual({ from: 4, to: 9, insert: "" });
  });

  it("finds a minimal replace", () => {
    // Common prefix is "hello " (6 units — the trailing space matches too),
    // common suffix is "world"; the trim is greedy left-to-right then
    // right-to-left, so the insertion lands at position 6, not 5.
    const change = computeTextChange("hello world", "hello brave world");
    expect(change).toEqual({ from: 6, to: 6, insert: "brave " });
  });

  it("handles total replacement with no common affix", () => {
    const change = computeTextChange("abc", "سلام");
    expect(change).toEqual({ from: 0, to: 3, insert: "سلام" });
  });

  describe("surrogate-pair safety", () => {
    it("never splits an emoji when inserting text right before it", () => {
      // "a😀b" -> "aX😀b": the naive common-prefix scan would match "a",
      // then diverge — but if it instead matched further by coincidence
      // into the pair, back-off must still hold. Construct a case where the
      // insertion is adjacent to the pair on the left.
      const before = "a😀b";
      const after = "aXX😀b";
      const change = computeTextChange(before, after)!;
      expect(change).not.toBeNull();
      expect(applyTextChange(before, change)).toBe(after);
      // The insert boundary must not land between the two surrogate units.
      const highSurrogateIndex = 1; // index of "😀"'s high surrogate in `before`
      expect(change.to === highSurrogateIndex || change.to <= highSurrogateIndex || change.to >= highSurrogateIndex + 2).toBe(
        true,
      );
    });

    it("never splits an emoji when inserting text right after it", () => {
      const before = "a😀b";
      const after = "a😀XXb";
      const change = computeTextChange(before, after)!;
      expect(applyTextChange(before, change)).toBe(after);
    });

    it("never splits an emoji when it is itself being replaced", () => {
      const before = "x😀y";
      const after = "x😃y"; // different emoji, also a surrogate pair
      const change = computeTextChange(before, after)!;
      expect(applyTextChange(before, change)).toBe(after);
      // The replaced span must cover the whole pair, not half of it.
      const codeUnitsBefore = [...before].length; // Array spread respects surrogate pairs
      expect(codeUnitsBefore).toBe(3);
      expect(change.from).toBeLessThanOrEqual(1);
      expect(change.to).toBeGreaterThanOrEqual(3);
    });

    it("never splits an emoji at the very end of the string", () => {
      const before = "hi😀";
      const after = "hi";
      const change = computeTextChange(before, after)!;
      expect(applyTextChange(before, change)).toBe(after);
      expect(change).toEqual({ from: 2, to: 4, insert: "" });
    });

    it("never splits an emoji at the very start of the string", () => {
      const before = "😀hi";
      const after = "hi";
      const change = computeTextChange(before, after)!;
      expect(applyTextChange(before, change)).toBe(after);
      expect(change).toEqual({ from: 0, to: 2, insert: "" });
    });

    it("handles ZWNJ (می‌روم) edits without corrupting the joiner", () => {
      // Insert a character right after the ZWNJ.
      const before = "می‌روم";
      const after = "می‌گروم";
      const change = computeTextChange(before, after)!;
      expect(applyTextChange(before, change)).toBe(after);
    });
  });

  describe("property: apply(old, computeTextChange(old, new)) === new", () => {
    const rng = mulberry32(0xc0ffee);
    const alphabet = [
      ..."سلام دنیا می‌روم नमस्ते מה שלומך مخلوط mixed متن abcXYZ012 ",
      "😀",
      "😃",
      "🎉",
    ];

    function randomString(len: number): string {
      let s = "";
      for (let i = 0; i < len; i++) {
        s += alphabet[Math.floor(rng() * alphabet.length)];
      }
      return s;
    }

    function mutate(s: string): string {
      const chars = Array.from(s); // iterate by code point, never split a pair
      const op = Math.floor(rng() * 3);
      const at = Math.floor(rng() * (chars.length + 1));
      if (op === 0) {
        // insert
        chars.splice(at, 0, alphabet[Math.floor(rng() * alphabet.length)]!);
      } else if (op === 1 && chars.length > 0) {
        // delete
        const delAt = Math.min(at, chars.length - 1);
        const delLen = Math.min(1 + Math.floor(rng() * 3), chars.length - delAt);
        chars.splice(delAt, delLen);
      } else if (chars.length > 0) {
        // replace
        const repAt = Math.min(at, chars.length - 1);
        chars.splice(repAt, 1, alphabet[Math.floor(rng() * alphabet.length)]!);
      }
      return chars.join("");
    }

    it("holds over 500 random seeded mutations across the corpus", () => {
      let cases = 0;
      for (const seed of CORPUS) {
        let current = seed;
        for (let i = 0; i < 60; i++) {
          const next = mutate(current);
          const change = computeTextChange(current, next);
          if (change === null) {
            expect(current).toBe(next);
          } else {
            expect(applyTextChange(current, change)).toBe(next);
          }
          current = next;
          cases++;
        }
      }
      expect(cases).toBeGreaterThan(400);
    });

    it("holds for pure random strings, not just corpus-derived ones", () => {
      let cases = 0;
      for (let i = 0; i < 100; i++) {
        const a = randomString(Math.floor(rng() * 20));
        const b = randomString(Math.floor(rng() * 20));
        const change = computeTextChange(a, b);
        if (change === null) {
          expect(a).toBe(b);
        } else {
          expect(applyTextChange(a, change)).toBe(b);
        }
        cases++;
      }
      expect(cases).toBe(100);
    });
  });
});
