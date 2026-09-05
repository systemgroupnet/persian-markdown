import { Annotation } from "@codemirror/state";

/**
 * Marks a transaction as the reconciliation of a remote edit — an incoming
 * `value` prop change that did not originate from this view's own typing
 * (PLAN.md §5.2, §5.8).
 *
 * `SourceView`'s `updateListener` checks every transaction in an update for
 * this annotation and, when present, does NOT call `onChange` for the
 * resulting document changes. Without this guard a remote edit applied to
 * the document would look identical to local typing and bounce straight
 * back out through `onChange`, which the session layer would then treat as
 * a second edit on top of the one it just sent down.
 *
 * This is independent of `Transaction.addToHistory` (also set on the same
 * dispatch, see `SourceView.tsx`) — that one keeps the change out of the
 * undo stack; this one keeps it out of the outgoing change stream.
 */
export const remoteEdit = Annotation.define<boolean>();
