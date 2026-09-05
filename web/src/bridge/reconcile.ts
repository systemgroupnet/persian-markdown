/**
 * Block-granular reconciliation — the remote-edit half of the bridge.
 *
 * PLAN.md §5.3 ("hazard two"): re-deserializing the whole document on every
 * remote keystroke and calling `setValue` would blow away the local
 * selection every time a collaborator types. The mitigation staged in M5 is
 * block-granular reconciliation: diff the OLD Slate value against a freshly
 * deserialized NEW one at the top level only, and report which top-level
 * block indices actually changed, so the caller can replace just those nodes
 * (via `editor.tf.replaceNodes`) and leave every other block — in particular
 * whichever block holds the local caret — completely untouched.
 *
 * This module is the pure half of that: given two Slate `Descendant[]`
 * arrays, which top-level indices differ, and did the block *count* change
 * (a structural edit — a paragraph inserted or removed somewhere), which
 * block-granular replacement can't handle and the caller must fall back to a
 * full `setValue` for. It knows nothing about Slate transforms, React, or
 * the editor instance — see `views/wysiwyg/WysiwygView.tsx` for how the
 * result is applied.
 */

import type { Descendant } from "platejs";

/** Structural equality over plain Slate node data (no functions, no cycles —
 * Descendant trees are JSON-shaped by construction). Doesn't assume key
 * order, unlike a naive `JSON.stringify` comparison, which matters here:
 * the OLD value may have had properties set via `setNodes` in a different
 * order than the freshly-deserialized NEW value constructs them in. */
export function nodesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!nodesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRec, key)) return false;
    if (!nodesEqual(aRec[key], bRec[key])) return false;
  }
  return true;
}

export interface BlockDiff {
  /** True when the top-level block count is unchanged — the precondition for
   * a block-granular (same-index) replacement. */
  sameLength: boolean;
  /** Top-level indices whose node differs between old and new. Only
   * meaningful when `sameLength` is true; when it's false the caller should
   * fall back to a full replace instead of trusting index alignment. */
  changedIndices: number[];
  /** True when there is nothing to do at all (old and new are equal). */
  isNoop: boolean;
}

export function diffBlocks(oldValue: readonly Descendant[], newValue: readonly Descendant[]): BlockDiff {
  const sameLength = oldValue.length === newValue.length;
  const changedIndices: number[] = [];
  const len = Math.min(oldValue.length, newValue.length);
  for (let i = 0; i < len; i++) {
    if (!nodesEqual(oldValue[i], newValue[i])) {
      changedIndices.push(i);
    }
  }
  const isNoop = sameLength && changedIndices.length === 0;
  return { sameLength, changedIndices, isNoop };
}
