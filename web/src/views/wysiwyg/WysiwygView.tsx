/**
 * The WYSIWYG view — PLAN.md's "hard one" (R1).
 *
 * Implements `EditorViewProps` (web/src/views/types.ts, not modified). Local
 * edits go through the diff bridge (web/src/bridge/diff.ts); remote `value`
 * changes go through block-granular reconciliation
 * (web/src/bridge/reconcile.ts); entering the mode goes through round-trip
 * normalisation detection (web/src/bridge/normalization.ts). See each
 * module's doc comment for the reasoning — this file is the wiring.
 */
import * as React from "react";

import type { Value } from "platejs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";

import { reconcileRemoteValue } from "@/bridge/apply-reconciliation";
import { computeTextChange } from "@/bridge/diff";
import { checkRoundTrip } from "@/bridge/normalization";
import { stripSingleTrailingNewline } from "@/bridge/serialize";
import type { EditorViewProps } from "@/views/types";

import { asMarkdownEditor } from "./markdown-editor";
import { wysiwygPlugins } from "./plugins";
import { WysiwygToolbar } from "./Toolbar";
import { type WysiwygStrings, wysiwygStrings } from "./strings";

const LOCAL_EDIT_DEBOUNCE_MS = 150;

/** Payload handed to `onNormalizationRequired`. `confirm`/`cancel` are how
 * the shell reports the user's decision back — there is no slot on the
 * shared `EditorViewProps` for that (and this file must not add one), so the
 * closures travel inside the callback payload itself instead of via a new
 * prop or an imperative ref. */
export interface NormalizationPreview {
  before: string;
  after: string;
  confirm: () => void;
  cancel: () => void;
}

export interface WysiwygViewProps extends EditorViewProps {
  /** Fired at most once, right after mount, if and only if
   * `serialize(deserialize(value)) !== value` (PLAN.md §5.3, hazard one).
   * Nothing is emitted through `onChange` unless/until `preview.confirm()`
   * is called. */
  onNormalizationRequired?: (preview: NormalizationPreview) => void;
}

export function WysiwygView(props: WysiwygViewProps) {
  const { value, onChange, readOnly, locale, onReady, onNormalizationRequired } = props;
  const strings = wysiwygStrings[locale] ?? wysiwygStrings.en;

  // KNOWN GAP: `remoteCursors` (and `onSelectionChange`) are not wired up.
  // Rendering another participant's caret, or reporting the local one,
  // requires mapping a UTF-16 markdown offset to a Slate `Point` (and back)
  // — PLAN §5.2's "offset↔node map built from remark's `position` data",
  // which does not exist yet. Left unimplemented rather than faked with an
  // approximate mapping that could show a caret in the wrong place.

  // The bridge's notion of "the markdown we last told the outside world
  // about" — the baseline every diff (local edit) and every echo-check
  // (remote update) is computed against. Initialized once to the value this
  // component was mounted with; from then on it's updated exactly at the
  // three points that change what's "current": a local edit emitted, a
  // normalisation confirmed, or a remote update reconciled.
  const lastKnownMarkdownRef = React.useRef(value);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mismatchRef = React.useRef<{ before: string; after: string } | null>(null);

  const [pendingNormalization, setPendingNormalization] = React.useState<{ before: string; after: string } | null>(
    null,
  );
  // Forces the toolbar to recompute active-mark/active-block state, which
  // reads directly off the mutable `editor` object rather than props/state.
  const [updateSignal, setUpdateSignal] = React.useState(0);

  const editor = usePlateEditor(
    {
      plugins: wysiwygPlugins,
      value: (ed) => {
        const mdEditor = asMarkdownEditor(ed);
        const markdown = lastKnownMarkdownRef.current;
        let initial: Value = [];
        const roundTrip = checkRoundTrip(
          markdown,
          (md) => {
            initial = mdEditor.api.markdown.deserialize(md);
            return initial;
          },
          (v) => stripSingleTrailingNewline(mdEditor.api.markdown.serialize({ value: v })),
        );
        if (!roundTrip.stable) {
          // Hazard one: don't adopt the round-tripped text as the baseline,
          // and don't emit anything — stash it for the effect below, which
          // runs once mounted and is the earliest safe point to call a
          // parent prop.
          mismatchRef.current = { before: markdown, after: roundTrip.after };
        }
        return initial;
      },
    },
    [],
  );

  const confirmNormalization = React.useCallback(() => {
    const mismatch = mismatchRef.current;
    if (!mismatch) return;
    onChange({ from: 0, to: mismatch.before.length, insert: mismatch.after });
    lastKnownMarkdownRef.current = mismatch.after;
    mismatchRef.current = null;
    setPendingNormalization(null);
  }, [onChange]);

  const cancelNormalization = React.useCallback(() => {
    // "Stay in source" — the shell is expected to switch the active view
    // mode away from WYSIWYG. If it doesn't (or can't, yet), the safest
    // local behaviour is to keep editing suspended rather than silently
    // adopt normalised text the user just declined.
    mismatchRef.current = null;
    setPendingNormalization(null);
  }, []);

  React.useEffect(() => {
    onReady?.();
    const mismatch = mismatchRef.current;
    if (!mismatch) return;
    setPendingNormalization(mismatch);
    onNormalizationRequired?.({
      before: mismatch.before,
      after: mismatch.after,
      confirm: confirmNormalization,
      cancel: cancelNormalization,
    });
    // Mount-only: entering the mode is a one-time check (PLAN §5.3), never
    // re-run on every remote `value` update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveReadOnly = Boolean(readOnly) || pendingNormalization !== null;

  // ---------------------------------------------------------------------
  // Local edit -> bridge (debounced serialize + diff)
  // ---------------------------------------------------------------------
  const flushLocalEdit = React.useCallback(() => {
    if (effectiveReadOnly) return;
    const serialized = stripSingleTrailingNewline(asMarkdownEditor(editor).api.markdown.serialize());
    const change = computeTextChange(lastKnownMarkdownRef.current, serialized);
    if (change) {
      lastKnownMarkdownRef.current = serialized;
      onChange(change);
    }
  }, [editor, effectiveReadOnly, onChange]);

  const handleEditorChange = React.useCallback(() => {
    setUpdateSignal((n) => n + 1);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(flushLocalEdit, LOCAL_EDIT_DEBOUNCE_MS);
  }, [flushLocalEdit]);

  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Remote edit -> block-granular reconciliation (PLAN §5.3, hazard two)
  // ---------------------------------------------------------------------
  React.useEffect(() => {
    if (value === lastKnownMarkdownRef.current) {
      // Either the initial mount, or the echo of our own emitted edit
      // (the session layer round-trips confirmed ops back through `value`).
      return;
    }
    if (pendingNormalization) {
      // A remote edit arrived while the user hasn't decided on
      // normalisation yet. Known gap: we don't attempt to reconcile in this
      // window (there is no confirmed local Slate baseline to diff
      // against safely) — the next resolution (confirm/cancel) re-syncs.
      return;
    }

    const newValue = asMarkdownEditor(editor).api.markdown.deserialize(value);
    reconcileRemoteValue(editor, newValue);
    setUpdateSignal((n) => n + 1);

    lastKnownMarkdownRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      // Common marks (task item 6). Block-level shortcuts (headings, lists,
      // quote, code block, table, hr) are toolbar-only for now — there's no
      // installed keymap plugin to hang them off, and inventing a bespoke
      // scheme for those risks colliding with the browser's own bindings.
      if (key === "b") {
        event.preventDefault();
        editor.tf.toggleMark("bold");
      } else if (key === "i") {
        event.preventDefault();
        editor.tf.toggleMark("italic");
      } else if (key === "e") {
        event.preventDefault();
        editor.tf.toggleMark("code");
      } else if (key === "x" && event.shiftKey) {
        event.preventDefault();
        editor.tf.toggleMark("strikethrough");
      }
    },
    [editor],
  );

  return (
    <Plate editor={editor} onChange={handleEditorChange} readOnly={effectiveReadOnly}>
      {/* No `dir` here: the toolbar and shell follow the ambient
          locale-driven `dir` from the app shell (PLAN §5.4); only
          block-level content nodes get `dir="auto"` (elements.tsx), so a
          per-paragraph content sniff never fights the UI's own direction. */}
      <div className="flex h-full flex-col">
        <WysiwygToolbar editor={editor} strings={strings} disabled={effectiveReadOnly} updateSignal={updateSignal} />

        {pendingNormalization && !onNormalizationRequired ? (
          // Only rendered when the shell didn't supply
          // `onNormalizationRequired` — otherwise the shell owns presenting
          // this prompt (it got the same confirm/cancel closures).
          <NormalizationBar strings={strings} onNormalize={confirmNormalization} onCancel={cancelNormalization} />
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <PlateContent
            readOnly={effectiveReadOnly}
            onKeyDown={handleKeyDown}
            className="prose-sm min-h-full max-w-none outline-none"
            placeholder=""
          />
        </div>
      </div>
    </Plate>
  );
}

/**
 * The "one-time bar" from PLAN.md §5.3. This local fallback only renders
 * when the shell hasn't supplied `onNormalizationRequired` (so the
 * component is still usable/testable standalone); when the shell *does*
 * supply the callback, it owns presenting the prompt (it received the same
 * `confirm`/`cancel` closures) and this bar is never shown.
 */
function NormalizationBar({
  strings,
  onNormalize,
  onCancel,
}: {
  strings: WysiwygStrings;
  onNormalize: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-b border-border bg-muted px-4 py-2 text-sm text-foreground">
      <p className="font-medium">{strings.normalization.title}</p>
      <p className="mt-1 text-muted-foreground">{strings.normalization.body}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onNormalize}
          className="rounded-[var(--radius)] border border-border bg-foreground px-2.5 py-1 text-xs font-medium text-background"
        >
          {strings.normalization.normalize}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius)] border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
        >
          {strings.normalization.stayInSource}
        </button>
      </div>
    </div>
  );
}
