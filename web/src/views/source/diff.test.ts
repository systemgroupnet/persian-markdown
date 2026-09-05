import { describe, expect, it } from "vitest";

import { computeMinimalReplace } from "./diff";

describe("computeMinimalReplace", () => {
  it("returns null for identical strings", () => {
    expect(computeMinimalReplace("سلام دنیا", "سلام دنیا")).toBeNull();
    expect(computeMinimalReplace("", "")).toBeNull();
  });

  it("finds a pure insertion at the end", () => {
    const r = computeMinimalReplace("سلام", "سلام دنیا");
    expect(r).toEqual({ from: 4, to: 4, insert: " دنیا" });
  });

  it("finds a pure insertion at the start", () => {
    const r = computeMinimalReplace("دنیا", "سلام دنیا");
    expect(r).toEqual({ from: 0, to: 0, insert: "سلام " });
  });

  it("finds a pure deletion in the middle", () => {
    const r = computeMinimalReplace("one two three", "one three");
    // "two three" and "three" share a trailing "t...hree", so the minimal
    // trim naturally lands past the first "t", not at the word boundary —
    // still a correct, minimal single-region replacement.
    expect(r).toEqual({ from: 5, to: 9, insert: "" });
    const applied = "one two three".slice(0, r!.from) + r!.insert + "one two three".slice(r!.to);
    expect(applied).toBe("one three");
  });

  it("finds a replacement in the middle, trimming shared prefix/suffix", () => {
    const r = computeMinimalReplace("the cat sat", "the dog sat");
    expect(r).toEqual({ from: 4, to: 7, insert: "dog" });
  });

  it("preserves ZWNJ (U+200C) untouched when the edit is elsewhere", () => {
    // می‌روم contains a ZWNJ between the ی and ر — a single UTF-16 unit,
    // 3 bytes in UTF-8 (PLAN.md §3.2's "most likely way to break Persian
    // text"). An edit after the word must not perturb it.
    const oldText = "می‌روم فردا";
    const newText = "می‌روم امروز";
    const r = computeMinimalReplace(oldText, newText);
    expect(r).not.toBeNull();
    // Applying the replacement must reproduce newText exactly, and in
    // particular must not have touched the ZWNJ inside "می‌روم".
    const applied = oldText.slice(0, r!.from) + r!.insert + oldText.slice(r!.to);
    expect(applied).toBe(newText);
    expect(applied).toContain("می‌روم");
  });

  it("never splits a surrogate pair on the prefix boundary", () => {
    // 😀 = U+1F600 = surrogate pair 😀. Deleting it entirely
    // must not leave a lone surrogate behind.
    const oldText = "a😀b";
    const newText = "ab";
    const r = computeMinimalReplace(oldText, newText);
    expect(r).toEqual({ from: 1, to: 3, insert: "" });
    const applied = oldText.slice(0, r!.from) + r!.insert + oldText.slice(r!.to);
    expect(applied).toBe(newText);
  });

  it("never splits a surrogate pair even when both texts share the same high surrogate", () => {
    // 😀 (U+1F600) and 😁 (U+1F601) share the high surrogate \uD83D, so a
    // naive unit-by-unit prefix scan would match one unit into the pair.
    const oldText = "X😀Y";
    const newText = "X😁Y";
    const r = computeMinimalReplace(oldText, newText);
    expect(r).toEqual({ from: 1, to: 3, insert: "😁" });
    const applied = oldText.slice(0, r!.from) + r!.insert + oldText.slice(r!.to);
    expect(applied).toBe(newText);
    // The whole emoji must appear intact as one surrogate pair, not split.
    expect([...r!.insert]).toEqual(["😁"]);
  });

  it("handles a full replacement with no shared prefix or suffix", () => {
    const r = computeMinimalReplace("abc", "xyz");
    expect(r).toEqual({ from: 0, to: 3, insert: "xyz" });
  });

  it("handles emptying the document", () => {
    const r = computeMinimalReplace("hello", "");
    expect(r).toEqual({ from: 0, to: 5, insert: "" });
  });

  it("handles typing into an empty document", () => {
    const r = computeMinimalReplace("", "hello");
    expect(r).toEqual({ from: 0, to: 0, insert: "hello" });
  });
});
