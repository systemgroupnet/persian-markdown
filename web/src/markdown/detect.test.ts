import { describe, expect, it } from "vitest";
import type { AstNode } from "./ast";
import { createDetectionResult, detectFromTree } from "./detect";

describe("detectFromTree", () => {
  it("finds no math/mermaid in a plain tree", () => {
    const tree: AstNode = {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "hello" }] }],
    };
    const result = createDetectionResult();
    detectFromTree(tree, result);
    expect(result.hasMath).toBe(false);
    expect(result.mermaidBlocks).toEqual([]);
    expect(result.codeBlocks).toEqual([]);
  });

  it("finds inline and block math nodes", () => {
    const tree: AstNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "inlineMath", value: "x^2" }] },
        { type: "math", value: "y=mx+b" },
      ],
    };
    const result = createDetectionResult();
    detectFromTree(tree, result);
    expect(result.hasMath).toBe(true);
  });

  it("collects mermaid fences separately from ordinary code fences", () => {
    const tree: AstNode = {
      type: "root",
      children: [
        { type: "code", lang: "mermaid", value: "graph TD; A-->B;" },
        { type: "code", lang: "JS", value: "const x = 1;" },
        { type: "code", lang: null, value: "no language" },
      ],
    };
    const result = createDetectionResult();
    detectFromTree(tree, result);
    expect(result.mermaidBlocks).toEqual(["graph TD; A-->B;"]);
    expect(result.codeLangs).toEqual(new Set(["js"]));
    expect(result.codeBlocks).toEqual([{ lang: "js", code: "const x = 1;" }]);
  });
});
