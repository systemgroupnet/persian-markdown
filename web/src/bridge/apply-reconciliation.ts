/**
 * Applies a `diffBlocks` result to a live editor: the imperative half of
 * block-granular reconciliation (`diffBlocks` itself, in reconcile.ts, is
 * the pure diff). Split out from `WysiwygView.tsx` so it can be exercised
 * directly against a real (non-React) Slate editor — `createSlateEditor`
 * carries every `editor.tf` transform this needs (`withoutSaving`,
 * `withoutNormalizing`, `replaceNodes`, `setValue`, `select`), since those
 * are core Slate/Plate features, not React ones. That's what lets the test
 * for this file set a real selection and assert it survives reconciliation,
 * instead of only unit-testing `diffBlocks` in isolation.
 */
import type { Descendant, Value } from "platejs";

import { diffBlocks } from "./reconcile";

/** The minimal editor surface this needs — deliberately not `PlateEditor`,
 * so this same function type-checks against both `createSlateEditor`'s
 * (non-React) and `usePlateEditor`'s (React) return types. */
export interface ReconcilableEditor {
  children: Descendant[];
  selection: { anchor: { path: number[] }; focus: { path: number[] } } | null;
  tf: {
    withoutSaving: (fn: () => void) => void;
    withoutNormalizing: (fn: () => void) => void;
    replaceNodes: (nodes: Descendant, options: { at: number[] }) => void;
    setValue: (value: Value) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches
    // Slate's own `At` union without importing it just for this parameter;
    // see the variance note this avoids at the call sites (a real editor's
    // `select` takes an optional `At`, which a strict `unknown` parameter
    // can't structurally accept).
    select: (target: any) => void;
  };
}

/**
 * Replace only the top-level blocks that actually changed, leaving the
 * block(s) the current selection spans untouched (PLAN §5.3, hazard two),
 * and never touching the local undo history (`withoutSaving` — PLAN §5.8).
 *
 * Falls back to a full `setValue` when the top-level block *count* changed
 * (a structural remote edit) — index alignment, which the block-granular
 * path relies on, doesn't hold across an insert/remove elsewhere. Full
 * cursor-preserving reconciliation for that case (mapping the selection
 * through a markdown-offset transform, PLAN §5.2) is explicitly staged for
 * later (§5.3); this function's fallback is the documented, honest gap.
 */
export function reconcileRemoteValue(editor: ReconcilableEditor, newValue: Value): void {
  const diff = diffBlocks(editor.children, newValue);
  if (diff.isNoop) return;

  const selectionSnapshot = editor.selection;
  const protectedIndices = new Set<number>();
  if (selectionSnapshot) {
    const anchorTop = selectionSnapshot.anchor.path[0];
    const focusTop = selectionSnapshot.focus.path[0];
    if (anchorTop !== undefined) protectedIndices.add(anchorTop);
    if (focusTop !== undefined) protectedIndices.add(focusTop);
  }

  editor.tf.withoutSaving(() => {
    editor.tf.withoutNormalizing(() => {
      if (diff.sameLength) {
        for (const index of diff.changedIndices) {
          if (protectedIndices.has(index)) continue; // leave the caret's block(s) alone
          const replacement = newValue[index];
          if (replacement) editor.tf.replaceNodes(replacement, { at: [index] });
        }
      } else {
        editor.tf.setValue(newValue);
      }
    });
  });

  if (selectionSnapshot) {
    try {
      editor.tf.select(selectionSnapshot);
    } catch {
      // Path no longer resolves (most likely after the structural fallback
      // above) — leave selection as Slate's own post-setValue default.
    }
  }
}
