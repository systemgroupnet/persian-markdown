import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { EditorViewProps, LocalSelection, RemoteCursor } from "../types";
import { remoteEdit } from "./annotations";
import { computeMinimalReplace } from "./diff";
import { remoteCursorBaseTheme, remoteCursorsField, setRemoteCursors } from "./remoteCursors";
import { sourceStrings } from "./strings";
import { createEditorTheme } from "./theme";

/** Trailing-edge throttle window for outgoing local selection reports. */
const SELECTION_THROTTLE_MS = 80;

const EMPTY_CURSORS: readonly [] = [];

/**
 * Props `SourceView` actually accepts: `EditorViewProps` (the contract),
 * plus one test-only escape hatch. `EditorViewProps` has no ref/imperative
 * handle, so component tests that need to drive CodeMirror directly
 * (dispatching a transaction to simulate a keystroke, invoking `undo`) have
 * no other way to reach the underlying `EditorView` — there is no
 * `@testing-library/react` in this project to query through, and adding
 * one is out of scope here. `onViewCreated` is never passed by the real
 * integrator; it costs it nothing since the field is optional.
 */
export interface SourceViewProps extends EditorViewProps {
  /** Test-only: called once with the underlying EditorView after mount. */
  onViewCreated?: (view: EditorView) => void;
}

/**
 * The markdown source view — plain CodeMirror 6 over the shared markdown
 * string (PLAN.md §2, §5.2). Implements `EditorViewProps` from
 * views/types.ts.
 *
 * Why CM6 instead of a `<textarea>`: `EditorView.perLineTextDirection`
 * (enabled below) gives every line its own auto-detected direction, which
 * is the difference between a readable and a scrambled document once
 * Persian and English lines are mixed in one file (PLAN.md §5.2, §5.4).
 * One consequence worth flagging for reviewers: on an RTL line the leading
 * `#`/`- ` markdown marker renders on the visual *right* edge of the line —
 * that is correct bidi behavior (the marker is the first logical character,
 * and RTL lines lay out right-to-left), not a bug.
 */
export function SourceView({
  value,
  onChange,
  onSelectionChange,
  remoteCursors,
  readOnly,
  locale,
  onReady,
  onViewCreated,
}: SourceViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Latest-callback refs: the update listener and effects below are set up
  // once (or reconfigured on a narrow, explicit dependency) and always read
  // through these, so a parent re-render that only changes a callback
  // identity never forces a full editor teardown/rebuild.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onViewCreatedRef = useRef(onViewCreated);
  onViewCreatedRef.current = onViewCreated;

  const readOnlyCompartment = useRef(new Compartment()).current;
  const attributesCompartment = useRef(new Compartment()).current;

  const selectionThrottleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    lastEmit: number;
    pending: LocalSelection | null;
  }>({ timer: null, lastEmit: 0, pending: null });

  const lastRemoteCursorsRef = useRef<readonly RemoteCursor[] | undefined>(undefined);

  // ---- mount: build the EditorView exactly once -------------------------
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    function emitSelection(state: EditorState): void {
      const handler = onSelectionChangeRef.current;
      if (!handler) return;

      const main = state.selection.main;
      const payload: LocalSelection = main.empty
        ? { pos: main.head }
        : { pos: main.head, selection: { from: main.anchor, to: main.head } };

      const box = selectionThrottleRef.current;
      box.pending = payload;
      if (box.timer) return; // a trailing flush is already scheduled

      const elapsed = Date.now() - box.lastEmit;
      if (elapsed >= SELECTION_THROTTLE_MS) {
        box.lastEmit = Date.now();
        box.pending = null;
        handler(payload);
      } else {
        box.timer = setTimeout(() => {
          box.timer = null;
          box.lastEmit = Date.now();
          if (box.pending) {
            const next = box.pending;
            box.pending = null;
            handler(next);
          }
        }, SELECTION_THROTTLE_MS - elapsed);
      }
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...markdownKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        // Per-line bidi auto-detection — see the module doc comment above.
        EditorView.perLineTextDirection.of(true),
        attributesCompartment.of(
          EditorView.contentAttributes.of({
            dir: "auto",
            "aria-label": sourceStrings[locale].source.editorLabel,
          }),
        ),
        readOnlyCompartment.of([
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.editable.of(!readOnly),
        ]),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        highlightActiveLine(),
        createEditorTheme(),
        remoteCursorBaseTheme,
        remoteCursorsField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const isRemote = update.transactions.some((tr) => tr.annotation(remoteEdit) === true);
            if (!isRemote) {
              // One TextChange per (from, to, insert) triple, UTF-16
              // offsets straight from CodeMirror — no byte conversion here,
              // that is the session layer's job (views/types.ts, PLAN.md
              // §3.2).
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                onChangeRef.current({ from: fromA, to: toA, insert: inserted.toString() });
              }, true);
            }
          }
          if (update.selectionSet) {
            emitSelection(update.state);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;

    if (remoteCursors && remoteCursors.length > 0) {
      lastRemoteCursorsRef.current = remoteCursors;
      view.dispatch({ effects: setRemoteCursors.of(remoteCursors) });
    }

    onReadyRef.current?.();
    onViewCreatedRef.current?.(view);

    return () => {
      const box = selectionThrottleRef.current;
      if (box.timer) clearTimeout(box.timer);
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-once: `value`/`readOnly`/`locale`/`remoteCursors`
    // are all synced by the effects below rather than by rebuilding the
    // view, so the user's cursor, scroll position and undo history survive
    // every prop change except the very first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- remote document reconciliation -----------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return; // already in sync — either unchanged,
    // or this is `value` catching up with an edit we just emitted
    // ourselves, echoed back through the parent's own state.

    const replacement = computeMinimalReplace(current, value);
    if (!replacement) return;

    view.dispatch({
      changes: replacement,
      annotations: [remoteEdit.of(true), Transaction.addToHistory.of(false)],
      // No explicit `selection`: CM maps the existing selection through the
      // change automatically, so the local caret and scroll position
      // survive a collaborator's edit landing elsewhere in the document.
    });
  }, [value]);

  // ---- readOnly ----------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, readOnlyCompartment]);

  // ---- locale (accessible name only — direction is per-line, see above) --
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: attributesCompartment.reconfigure(
        EditorView.contentAttributes.of({
          dir: "auto",
          "aria-label": sourceStrings[locale].source.editorLabel,
        }),
      ),
    });
  }, [locale, attributesCompartment]);

  // ---- remote cursors -----------------------------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = remoteCursors ?? EMPTY_CURSORS;
    if (cursorsEqual(lastRemoteCursorsRef.current ?? EMPTY_CURSORS, next)) return;
    lastRemoteCursorsRef.current = next;
    view.dispatch({ effects: setRemoteCursors.of(next) });
  }, [remoteCursors]);

  return <div ref={containerRef} className="pmd-source-view" style={{ height: "100%" }} />;
}

function cursorsEqual(
  a: EditorViewProps["remoteCursors"],
  b: EditorViewProps["remoteCursors"],
): boolean {
  const listA = a ?? EMPTY_CURSORS;
  const listB = b ?? EMPTY_CURSORS;
  if (listA === listB) return true;
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const x = listA[i];
    const y = listB[i];
    if (!x || !y) return false;
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.hue !== y.hue ||
      x.pos !== y.pos ||
      x.selection?.from !== y.selection?.from ||
      x.selection?.to !== y.selection?.to
    ) {
      return false;
    }
  }
  return true;
}
