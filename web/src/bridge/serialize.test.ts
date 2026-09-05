import { describe, expect, it } from "vitest";

import { stripSingleTrailingNewline } from "./serialize";

describe("stripSingleTrailingNewline", () => {
  it("strips exactly one trailing newline", () => {
    expect(stripSingleTrailingNewline("hello\n")).toBe("hello");
  });

  it("leaves a second trailing newline (a genuine trailing blank line) intact", () => {
    expect(stripSingleTrailingNewline("hello\n\n")).toBe("hello\n");
  });

  it("is a no-op when there is no trailing newline", () => {
    expect(stripSingleTrailingNewline("hello")).toBe("hello");
  });

  it("handles the empty string", () => {
    expect(stripSingleTrailingNewline("")).toBe("");
  });
});
