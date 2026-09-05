import { describe, expect, it } from "vitest";

import { OffsetIndex } from "./offsets";
import { Utf8Error, utf8Length } from "./utf8";

const ZWNJ = "‌";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Move a position off the inside of a surrogate pair. */
function snap(text: string, pos: number): number {
  if (pos > 0 && pos < text.length) {
    const prev = text.charCodeAt(pos - 1);
    const cur = text.charCodeAt(pos);
    if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) return pos - 1;
  }
  return pos;
}

const ALPHABET = ["س", "ل", "ا", ZWNJ, "א", "न", "😀", "a", "Z", " ", "\n", "\n", "#"];

function randomText(rng: () => number, maxLen: number): string {
  let s = "";
  const n = Math.floor(rng() * maxLen);
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)]!;
  return s;
}

describe("OffsetIndex", () => {
  it("converts Persian text where units and bytes diverge", () => {
    const idx = new OffsetIndex("سلام");
    expect(idx.byteLength).toBe(8);
    expect(idx.toBytes(0)).toBe(0);
    expect(idx.toBytes(1)).toBe(2);
    expect(idx.toBytes(4)).toBe(8);
    expect(idx.toUnits(8)).toBe(4);
    expect(idx.toUnits(2)).toBe(1);
  });

  it("handles ZWNJ inside a word", () => {
    const doc = "می‌روم"; // م ی ZWNJ ر و م
    const idx = new OffsetIndex(doc);
    expect(idx.byteLength).toBe(13);
    // ZWNJ is one UTF-16 unit at index 2, three bytes at offset 4.
    expect(idx.toBytes(2)).toBe(4);
    expect(idx.toBytes(3)).toBe(7);
    expect(idx.toUnits(4)).toBe(2);
    expect(idx.toUnits(7)).toBe(3);
  });

  it("handles astral characters that are two UTF-16 units", () => {
    const idx = new OffsetIndex("a😀b");
    expect(idx.byteLength).toBe(6);
    expect(idx.toBytes(1)).toBe(1);
    expect(idx.toBytes(3)).toBe(5); // after the surrogate pair
    expect(idx.toUnits(5)).toBe(3);
  });

  it("rejects a byte offset inside a character", () => {
    const idx = new OffsetIndex("سلام");
    expect(() => idx.toUnits(1)).toThrow(Utf8Error);
    expect(() => idx.toUnits(3)).toThrow(Utf8Error);
  });

  it("converts across multiple lines", () => {
    const doc = "# عنوان\nمتن\nآخر";
    const idx = new OffsetIndex(doc);
    expect(idx.lineCount).toBe(3);
    for (let i = 0; i <= doc.length; i++) {
      expect(idx.toUnits(idx.toBytes(i)), `unit ${i}`).toBe(i);
    }
  });

  it("clamps out-of-range offsets instead of throwing", () => {
    const idx = new OffsetIndex("سلام");
    expect(idx.toBytes(-10)).toBe(0);
    expect(idx.toBytes(999)).toBe(8);
    expect(idx.toUnits(-10)).toBe(0);
    expect(idx.toUnits(999)).toBe(4);
  });

  it("round-trips every position of a mixed document", () => {
    const doc = `# عنوان\n\nسلام mixed متن\n- می‌روم\n- a😀b\nמה שלומך\nनमस्ते\n`;
    const idx = new OffsetIndex(doc);
    expect(idx.byteLength).toBe(utf8Length(doc));
    for (let i = 0; i <= doc.length; i++) {
      const bytes = idx.toBytes(i);
      // Skip positions inside a surrogate pair: they are not character
      // boundaries and have no byte equivalent, which callers never ask for.
      if (i > 0 && doc.charCodeAt(i - 1) >= 0xd800 && doc.charCodeAt(i - 1) <= 0xdbff) continue;
      expect(idx.toUnits(bytes), `position ${i}`).toBe(i);
    }
  });

  /**
   * The important one. `replace` updates the index in place for speed; if it
   * ever disagrees with a fresh rebuild, every offset after the edit is wrong
   * and the corruption is silent. This runs thousands of random edits and
   * compares the incremental index against a from-scratch one after each.
   */
  it("stays identical to a full rebuild across random edits", () => {
    const rng = mulberry32(161803);

    for (let trial = 0; trial < 300; trial++) {
      let text = randomText(rng, 40);
      const idx = new OffsetIndex(text);

      for (let step = 0; step < 12; step++) {
        // Snap to character boundaries: a real editor never hands us a change
        // that splits a surrogate pair, and OffsetIndex now rejects one.
        const from = snap(text, Math.floor(rng() * (text.length + 1)));
        const to = snap(text, Math.min(text.length, from + Math.floor(rng() * 6)));
        const inserted = randomText(rng, 6);

        idx.replace(from, to, inserted);
        text = text.slice(0, from) + inserted + text.slice(to);

        const fresh = new OffsetIndex(text);
        expect(idx.document, `trial ${trial} step ${step}: text`).toBe(text);
        expect(idx.byteLength, `trial ${trial} step ${step}: byteLength`).toBe(
          fresh.byteLength,
        );
        expect(idx.lineCount, `trial ${trial} step ${step}: lineCount`).toBe(
          fresh.lineCount,
        );

        // Every position must convert identically in both indexes.
        for (let i = 0; i <= text.length; i++) {
          expect(idx.toBytes(i), `trial ${trial} step ${step}: toBytes(${i})`).toBe(
            fresh.toBytes(i),
          );
        }
      }
    }
  });
});
