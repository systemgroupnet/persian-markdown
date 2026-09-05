/**
 * Cheap, AST-based feature detection for the lazy-loading requirement
 * (PLAN.md §5.7): KaTeX and Mermaid must never be paid for by a document
 * that doesn't need them, and that decision has to come from the parsed
 * tree — not a regex over the raw markdown source.
 *
 * `makeDetectPlugin` is a remark plugin (passed into react-markdown's
 * `remarkPlugins`) that walks the mdast tree react-markdown already built
 * (remark-parse -> remark-gfm -> remark-math) and reports what it found by
 * mutating a plain object the caller owns. It runs during react-markdown's
 * synchronous render pass, so results land in `result` before the pass
 * returns — the caller reads them from a `useEffect` (after render), never
 * during render itself, to decide whether to kick off a dynamic import.
 */

import { walkAst, type AstNode } from "./ast";

export interface DetectionResult {
  hasMath: boolean;
  /** Distinct fence languages seen, lower-cased, "mermaid" excluded. */
  codeLangs: Set<string>;
  /** Every fenced code block with a language other than mermaid, in order. */
  codeBlocks: { lang: string; code: string }[];
  /** Every ```mermaid fence's raw source, in document order. */
  mermaidBlocks: string[];
}

export function createDetectionResult(): DetectionResult {
  return { hasMath: false, codeLangs: new Set(), codeBlocks: [], mermaidBlocks: [] };
}

export function detectFromTree(tree: AstNode, result: DetectionResult): void {
  walkAst(tree, (node) => {
    if (node.type === "math" || node.type === "inlineMath") {
      result.hasMath = true;
      return;
    }
    if (node.type === "code") {
      const lang = (node.lang ?? "").trim().toLowerCase();
      if (lang === "mermaid") {
        result.mermaidBlocks.push(node.value ?? "");
      } else if (lang) {
        result.codeLangs.add(lang);
        result.codeBlocks.push({ lang, code: node.value ?? "" });
      }
    }
  });
}

/**
 * A unified/remark plugin factory. Usage:
 *
 *   const result = createDetectionResult();
 *   <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, makeDetectPlugin(result)]} />
 *
 * The plugin returns the tree unchanged — it only observes it.
 */
export function makeDetectPlugin(result: DetectionResult) {
  return () => (tree: AstNode) => {
    detectFromTree(tree, result);
    return tree;
  };
}
