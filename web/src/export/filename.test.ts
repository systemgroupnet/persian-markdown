import { describe, expect, it } from "vitest";

import { deriveFilename, deriveFilenameStem, extractFirstH1, slugify } from "./filename";

describe("extractFirstH1", () => {
  it("finds an ATX heading", () => {
    expect(extractFirstH1("intro\n\n# سلام دنیا\n\nbody")).toBe("سلام دنیا");
  });

  it("finds a setext heading", () => {
    expect(extractFirstH1("عنوان سند\n=========\n\nbody")).toBe("عنوان سند");
  });

  it("ignores an H2", () => {
    expect(extractFirstH1("## not this\n\n# but this")).toBe("but this");
  });

  it("returns null when there is no H1", () => {
    expect(extractFirstH1("just a paragraph, no heading here")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractFirstH1("")).toBeNull();
  });
});

describe("slugify", () => {
  it("preserves Persian characters verbatim (no transliteration)", () => {
    expect(slugify("سلام دنیا")).toBe("سلام-دنیا");
  });

  it("preserves ZWNJ inside a Persian word instead of splitting it", () => {
    // "می‌روم" contains U+200C between "می" and "روم".
    const withZwnj = "می‌روم به خانه";
    const slug = slugify(withZwnj);
    expect(slug).toContain("‌");
    expect(slug).toBe("می‌روم-به-خانه");
  });

  it("collapses punctuation/whitespace runs to a single hyphen and trims edges", () => {
    expect(slugify("  Hello,   World!!  ")).toBe("Hello-World");
  });

  it("returns empty string for input that is all punctuation", () => {
    expect(slugify("!!! ??? ...")).toBe("");
  });
});

describe("deriveFilenameStem / deriveFilename", () => {
  it("derives from a Persian H1 including ZWNJ", () => {
    const markdown = "# گزارش می‌روم به مدرسه\n\nمتن سند اینجاست.";
    expect(deriveFilenameStem(markdown, "untitled")).toBe("گزارش-می‌روم-به-مدرسه");
    expect(deriveFilename(markdown, "untitled")).toBe("گزارش-می‌روم-به-مدرسه.md");
  });

  it("falls back when there is no heading", () => {
    expect(deriveFilenameStem("no heading at all here", "untitled")).toBe("untitled");
    expect(deriveFilename("no heading at all here", "untitled")).toBe("untitled.md");
  });

  it("falls back when the heading slugifies to nothing", () => {
    expect(deriveFilenameStem("# !!! ???", "بدون-عنوان")).toBe("بدون-عنوان");
  });

  it("falls back to the raw fallback string if it also slugifies to nothing", () => {
    expect(deriveFilenameStem("", "")).toBe("");
  });
});
