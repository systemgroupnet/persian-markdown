/**
 * The contract between the editor views and the collaboration session.
 *
 * Every view — source, split, WYSIWYG — is a projection of one markdown string
 * (PLAN.md §2). A view's entire job is to render `value` and report local user
 * intent through `onChange`. Nothing here mentions OT, websockets, or Slate:
 * that separation is what lets the same views work identically in a shared room
 * and in the private local document.
 *
 * OWNED BY THE INTEGRATOR. Views import from this file and must not modify it —
 * several are built in parallel, and a change here breaks the others.
 */

/**
 * A local edit, in UTF-16 code units — the unit CodeMirror, Slate and
 * `selectionStart` all speak natively.
 *
 * Conversion to the UTF-8 byte offsets the protocol uses happens exactly once,
 * in the session layer, via OffsetIndex. Views must never convert offsets
 * themselves; see PLAN.md §3.2 for why that rule exists.
 */
export interface TextChange {
  /** Start of the replaced range, UTF-16 offset into the current value. */
  from: number;
  /** End of the replaced range (== from for a pure insertion). */
  to: number;
  /** Replacement text ("" for a pure deletion). */
  insert: string;
}

/** Where another participant is looking, in UTF-16 offsets. */
export interface RemoteCursor {
  id: number;
  name: string;
  /** Hue in [0,360). The only colour in the product — the UI is monochrome. */
  hue: number;
  /** Caret position. */
  pos: number;
  /** Optional selection range; anchor may be after head. */
  selection?: { from: number; to: number };
}

/** Local selection, reported so the session can broadcast it. */
export interface LocalSelection {
  pos: number;
  selection?: { from: number; to: number };
}

export type Locale = "fa" | "en";

/**
 * Props shared by every editing surface.
 *
 * `value` is authoritative. When it changes for a reason other than the user's
 * own typing — a remote edit arriving — the view must reconcile to it WITHOUT
 * emitting onChange, and without pushing that change onto the local undo stack
 * (PLAN.md §5.8: Ctrl+Z must never revert a collaborator's work).
 */
export interface EditorViewProps {
  value: string;
  onChange: (change: TextChange) => void;
  onSelectionChange?: (selection: LocalSelection) => void;
  remoteCursors?: readonly RemoteCursor[];
  readOnly?: boolean;
  locale: Locale;
  /** Called once the view is mounted and ready, for focus management. */
  onReady?: () => void;
}

/** Props for the read-only rendered preview. */
export interface PreviewProps {
  markdown: string;
  locale: Locale;
  /** Scroll position as a 0..1 fraction, for split-view sync. */
  scrollFraction?: number;
  onScrollFractionChange?: (fraction: number) => void;
}
