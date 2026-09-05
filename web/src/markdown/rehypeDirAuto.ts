/**
 * RTL rehype plugin (PLAN.md §5.4).
 *
 * `dir="auto"` on every block-level element IS the Unicode first-strong
 * heuristic, implemented natively by the browser: a Persian paragraph
 * renders RTL, an English one LTR, in the same document, with zero JS.
 *
 * Two refinements beyond a blind `dir="auto"` sweep:
 *
 * 1. Code (inline and fenced) is force-`dir="ltr"`. A shell flag or a path
 *    inside an RTL paragraph would otherwise have its characters visually
 *    reordered by the bidi algorithm and become uncopyable/unreadable.
 * 2. GFM table-cell alignment. `remark-gfm` + `mdast-util-to-hast` turn
 *    `:--`/`--:` markers into a physical `align="left"`/`align="right"`
 *    HAST property at the point rehype plugins run (the later
 *    `hast-util-to-jsx-runtime` step — after every rehype plugin, including
 *    this one — is what turns a *leftover* `align` into an inline
 *    `text-align` style for React, since `align` itself isn't a valid DOM
 *    prop). Either way it's a physical value that won't adapt when a
 *    table's own `dir` flips to rtl. A column authored as "the leading
 *    column" (`:--`) should stay the leading column in either direction, so
 *    this rewrites `align`/`style` left/right to a logical inline
 *    `text-align:start`/`text-align:end` ourselves — before that automatic
 *    conversion can — and removes `align` so nothing re-derives a physical
 *    value from it afterwards. `center` is untouched: it has no physical/
 *    logical distinction.
 */

import { walkAst, type AstNode } from "./ast";

const AUTO_DIR_TAGS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "td",
  "th",
  "dd",
  "dt",
  "table",
]);

const FORCE_LTR_TAGS = new Set(["code", "pre"]);

const TABLE_CELL_TAGS = new Set(["td", "th"]);

function logicalizeTextAlign(style: string): string {
  return style.replace(/text-align\s*:\s*(left|right)\b/gi, (_match, side: string) =>
    side.toLowerCase() === "left" ? "text-align:start" : "text-align:end",
  );
}

function styleForAlign(align: string): string | undefined {
  switch (align.toLowerCase()) {
    case "left":
      return "text-align:start";
    case "right":
      return "text-align:end";
    case "center":
      return "text-align:center";
    default:
      return undefined;
  }
}

export function rehypeDirAuto() {
  return (tree: AstNode) => {
    walkAst(tree, (node) => {
      if (node.type !== "element" || !node.tagName) return;

      if (TABLE_CELL_TAGS.has(node.tagName) && node.properties) {
        const { align, style, ...rest } = node.properties as {
          align?: unknown;
          style?: unknown;
          [key: string]: unknown;
        };
        if (typeof align === "string") {
          const logical = styleForAlign(align);
          node.properties = logical ? { ...rest, style: logical } : rest;
        } else if (typeof style === "string") {
          node.properties = { ...rest, style: logicalizeTextAlign(style) };
        }
      }

      if (FORCE_LTR_TAGS.has(node.tagName)) {
        node.properties = { ...node.properties, dir: "ltr" };
      } else if (AUTO_DIR_TAGS.has(node.tagName)) {
        node.properties = { ...node.properties, dir: "auto" };
      }
    });
    return tree;
  };
}
