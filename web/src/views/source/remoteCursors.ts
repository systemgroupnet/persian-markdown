import { type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import type { RemoteCursor } from "../types";

/** Dispatched whenever the `remoteCursors` prop changes. */
export const setRemoteCursors = StateEffect.define<readonly RemoteCursor[]>();

/**
 * Holds the decorations for every peer's caret + selection. Rebuilt only
 * when `setRemoteCursors` fires or the document changes shape (the effect's
 * positions are re-clamped against the new doc length defensively — the
 * session layer is responsible for transforming cursor positions across
 * edits, but a stale position must never crash rendering).
 *
 * Colour is the *only* place this view uses anything but the neutral ramp:
 * `hue` from RemoteCursor (PLAN.md: "the only colour in the product is
 * remote cursors"). Saturation and lightness are fixed constants chosen so
 * any hue stays legible against both the light and dark `--background` /
 * `--foreground` pair in theme.css.
 */
export const remoteCursorsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    let cursors: readonly RemoteCursor[] | null = null;
    for (const effect of tr.effects) {
      if (effect.is(setRemoteCursors)) cursors = effect.value;
    }
    if (cursors === null) {
      // No new cursor data this transaction: keep the existing decorations,
      // remapped through any document changes (e.g. local typing) so they
      // stay anchored to the right spot until fresher data arrives.
      return tr.docChanged ? value.map(tr.changes) : value;
    }
    return buildDecorations(cursors, tr.state.doc.length);
  },
  provide: (field) => EditorView.decorations.compute([field], (state) => state.field(field)),
});

const CARET_LIGHTNESS = 45;
const SELECTION_LIGHTNESS = 55;
const SATURATION = 70;

function hueColor(hue: number, lightness: number, alpha?: number): string {
  const clamped = ((hue % 360) + 360) % 360;
  return alpha === undefined
    ? `hsl(${clamped} ${SATURATION}% ${lightness}%)`
    : `hsl(${clamped} ${SATURATION}% ${lightness}% / ${alpha})`;
}

function clamp(pos: number, docLength: number): number {
  return Math.max(0, Math.min(pos, docLength));
}

function buildDecorations(cursors: readonly RemoteCursor[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const cursor of cursors) {
    if (cursor.selection) {
      const from = clamp(Math.min(cursor.selection.from, cursor.selection.to), docLength);
      const to = clamp(Math.max(cursor.selection.from, cursor.selection.to), docLength);
      if (from < to) {
        ranges.push(
          Decoration.mark({
            class: "cm-remote-selection",
            attributes: { style: `background-color: ${hueColor(cursor.hue, SELECTION_LIGHTNESS, 0.28)}` },
          }).range(from, to),
        );
      }
    }

    const pos = clamp(cursor.pos, docLength);
    ranges.push(Decoration.widget({ widget: new RemoteCaretWidget(cursor), side: 1 }).range(pos));
  }

  // `sort: true` lets Decoration.set work out valid from/side ordering
  // itself (marks and zero-length widgets can legitimately share a
  // position), rather than this module having to replicate RangeSetBuilder's
  // ordering rules by hand.
  return Decoration.set(ranges, true);
}

/**
 * A zero-width caret + name flag rendered at a peer's cursor position. Built
 * as a widget (not a mark) so it never participates in text layout — it
 * cannot shift surrounding characters regardless of content length.
 */
class RemoteCaretWidget extends WidgetType {
  constructor(private readonly cursor: RemoteCursor) {
    super();
  }

  override eq(other: RemoteCaretWidget): boolean {
    return (
      other.cursor.id === this.cursor.id &&
      other.cursor.hue === this.cursor.hue &&
      other.cursor.name === this.cursor.name
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-remote-caret";
    wrap.style.borderInlineStartColor = hueColor(this.cursor.hue, CARET_LIGHTNESS);

    const flag = document.createElement("span");
    flag.className = "cm-remote-caret-flag";
    flag.style.backgroundColor = hueColor(this.cursor.hue, CARET_LIGHTNESS);
    // Fixed white label text: at the constant saturation/lightness used for
    // every hue above, contrast against white stays readable across the
    // whole hue range in both light and dark theme.
    flag.style.color = "white";
    flag.textContent = this.cursor.name;

    wrap.appendChild(flag);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Structural (non-color) CSS for remote cursor decorations. */
export const remoteCursorBaseTheme = EditorView.baseTheme({
  ".cm-remote-caret": {
    position: "relative",
    display: "inline-block",
    width: "0px",
    height: "1.2em",
    verticalAlign: "text-bottom",
    borderInlineStart: "2px solid",
  },
  ".cm-remote-caret-flag": {
    position: "absolute",
    insetInlineStart: "0",
    bottom: "100%",
    fontSize: "10px",
    lineHeight: "1.4",
    padding: "0 4px",
    borderRadius: "var(--radius, 2px)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".cm-remote-selection": {
    borderRadius: "var(--radius, 2px)",
  },
});
