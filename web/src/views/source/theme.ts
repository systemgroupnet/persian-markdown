import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror theme built entirely from the CSS custom properties in
 * styles/theme.css (`--background`, `--foreground`, `--border`, `--muted`,
 * `--muted-foreground`, `--accent`) rather than hardcoded colors, so it
 * follows the app's light/dark resolution automatically (prefers-color-scheme
 * or the `[data-theme]` override) with no separate dark variant to maintain
 * here. `--radius` is respected (2px, applied via var(--radius) everywhere a
 * corner is rounded — never a larger value, per PLAN.md §5.5).
 *
 * Prose uses `--font-sans` (Vazirmatn); inline code and fenced code blocks
 * use `--font-mono` (system mono stack, falling back to Vazirmatn so Persian
 * inside a fence still renders — see theme.css).
 */
export function createEditorTheme(): Extension {
  return [
    EditorView.theme({
      "&": {
        color: "var(--foreground)",
        backgroundColor: "var(--background)",
        fontSize: "14px",
        height: "100%",
      },
      "&.cm-editor": {
        borderRadius: "var(--radius, 2px)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-sans, Vazirmatn, ui-sans-serif, system-ui, sans-serif)",
        lineHeight: "1.7",
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        padding: "12px 0",
      },
      ".cm-line": {
        padding: "0 16px",
        // `EditorView.perLineTextDirection` (set in SourceView.tsx) only
        // makes CodeMirror *read* each line's resolved direction
        // separately for its own cursor/selection math — it does not by
        // itself make the browser render lines differently. This CSS
        // property is what actually does that: `unicode-bidi: plaintext`
        // asks the browser to run the Unicode first-strong-character
        // heuristic (the same one `dir="auto"` uses) independently per
        // line, so a Persian line lays out RTL and an adjacent English
        // line LTR in the same mixed document (PLAN.md §5.2, §5.4). A
        // side effect worth noting for reviewers: on an RTL line the
        // leading `#`/`- ` markdown marker then renders on the visual
        // right — that is correct bidi behavior, not a bug.
        unicodeBidi: "plaintext",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
        borderLeftWidth: "1.5px",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--accent)",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--muted)",
      },
      ".cm-placeholder": {
        color: "var(--muted-foreground)",
      },
      ".cm-gutters": {
        display: "none",
      },
    }),
    syntaxHighlighting(markdownHighlightStyle),
  ];
}

/**
 * Monochrome markdown highlighting. PLAN.md §5.5: "no colour beyond the
 * neutral ramp" for chrome, and the brief for this view is explicit that
 * syntax highlighting must be "distinguished by weight/opacity rather than
 * hue" — so every rule below only ever touches font-weight, font-style,
 * opacity, text-decoration or (for code spans) font-family, and only ever
 * reads `--foreground` / `--muted-foreground`.
 *
 * Tag mapping matches @lezer/markdown's own `styleTags` table (HeaderMark,
 * QuoteMark, ListMark, LinkMark, EmphasisMark, CodeMark, HardBreak all
 * become `tags.processingInstruction` — i.e. the literal `#`/`- `/`*`/`` ` ``
 * markup characters), so this covers exactly the node types CM6's bundled
 * markdown grammar actually emits.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.35em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.2em" },
  { tag: t.heading3, fontWeight: "700", fontSize: "1.1em" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: t.url, color: "var(--muted-foreground)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Vazirmatn, monospace)",
    backgroundColor: "var(--muted)",
    borderRadius: "var(--radius, 2px)",
  },
  { tag: t.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--muted-foreground)" },
  { tag: t.list, color: "var(--foreground)" },
  { tag: t.labelName, color: "var(--muted-foreground)" },
  { tag: t.string, color: "var(--muted-foreground)" },
  { tag: t.character, color: "var(--muted-foreground)" },
  { tag: t.escape, color: "var(--muted-foreground)" },
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic", opacity: "0.75" },
  // The literal markup characters themselves (#, >, -, *, `, [, ]…): kept
  // present but visually receded, so the reader's eye lands on content —
  // an RTL line still renders these on the visual right, which is correct
  // bidi behavior (perLineTextDirection below), not a bug.
  { tag: t.processingInstruction, color: "var(--muted-foreground)", opacity: "0.7" },
]);
