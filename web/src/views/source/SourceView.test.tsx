// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteCursor, TextChange } from "../types";
import { SourceView, type SourceViewProps } from "./SourceView";

// No @testing-library/react here (not a project dependency), so `act`
// from "react" is driven directly — it needs this flag set itself,
// which @testing-library/react would otherwise do for us.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = null;
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  container.remove();
});

/**
 * Mounts SourceView and resolves once the underlying EditorView exists,
 * via the test-only `onViewCreated` hook (see SourceView.tsx — there is no
 * `@testing-library/react` in this project to reach it any other way).
 */
function mount(props: Omit<SourceViewProps, "onViewCreated">): { view: EditorView; rerender: (next: Omit<SourceViewProps, "onViewCreated">) => void } {
  let view!: EditorView;
  root = createRoot(container);
  act(() => {
    root!.render(<SourceView {...props} onViewCreated={(v) => (view = v)} />);
  });
  return {
    view,
    rerender(next) {
      act(() => {
        root!.render(<SourceView {...next} onViewCreated={(v) => (view = v)} />);
      });
    },
  };
}

describe("SourceView", () => {
  it("emits one TextChange per local edit, in exact UTF-16 offsets (Persian + ZWNJ + emoji)", () => {
    // می‌روم contains ZWNJ (U+200C, one UTF-16 unit); 😀 is a surrogate
    // pair (two UTF-16 units) — offsets must be counted in units, not
    // characters or bytes, for this test to pass by coincidence.
    const value = "سلام 😀 می‌روم";
    const onChange = vi.fn<(change: TextChange) => void>();
    const { view } = mount({ value, onChange, locale: "fa" });

    // Insert right before the emoji (a position that only lands correctly
    // if earlier characters were counted in UTF-16 units).
    const emojiPos = value.indexOf("😀");
    act(() => {
      view.dispatch({ changes: { from: emojiPos, to: emojiPos, insert: "X" } });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ from: emojiPos, to: emojiPos, insert: "X" });

    // Replace the whole ZWNJ-bearing word; the reported range must span
    // exactly its UTF-16 length (6 units: م ی ZWNJ ر و م), including the
    // ZWNJ, not the 4 "visible" characters or the emoji-shifted byte count.
    const word = "می‌روم";
    expect(word.length).toBe(6);
    const wordStart = view.state.doc.toString().indexOf(word);
    act(() => {
      view.dispatch({
        changes: { from: wordStart, to: wordStart + word.length, insert: "رفتم" },
      });
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({
      from: wordStart,
      to: wordStart + word.length,
      insert: "رفتم",
    });
  });

  it("reconciles an external value change without emitting onChange", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const { view, rerender } = mount({ value: "سلام دنیا", onChange, locale: "fa" });

    rerender({ value: "سلام بزرگ دنیا", onChange, locale: "fa" });

    expect(onChange).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("سلام بزرگ دنیا");
  });

  it("keeps a remote reconciliation out of the undo stack, so undo only reverts local work", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const { view, rerender } = mount({ value: "AAAA", onChange, locale: "fa" });

    // Local edit: insert "X" at the start — this SHOULD be undoable.
    act(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: "X" } });
    });
    expect(view.state.doc.toString()).toBe("XAAAA");

    // Remote edit arrives as a prop change: append "Z" at the end. This
    // must NOT be undoable, and must not be reported via onChange.
    const changeCountBeforeRemote = onChange.mock.calls.length;
    rerender({ value: "XAAAAZ", onChange, locale: "fa" });
    expect(view.state.doc.toString()).toBe("XAAAAZ");
    expect(onChange.mock.calls.length).toBe(changeCountBeforeRemote);

    // Ctrl+Z must revert only the user's own "X" insertion. CM6's history
    // maps that recorded change through the intervening (unrecorded)
    // remote change, so undo removes "X" but leaves "Z" in place —
    // restoring the user's own previous state, not the collaborator's.
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("AAAAZ");
  });

  it("enables per-line bidi direction detection", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const { view } = mount({ value: "سلام / hello", onChange, locale: "fa" });
    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true);
  });

  it("respects readOnly", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const { view } = mount({ value: "سلام", onChange, locale: "fa", readOnly: true });
    expect(view.state.facet(EditorState.readOnly)).toBe(true);
    expect(view.state.facet(EditorView.editable)).toBe(false);
  });

  it("renders remote cursor decorations (caret + name flag + selection)", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const cursors: RemoteCursor[] = [
      { id: 1, name: "یوزپلنگ ایرانی", hue: 200, pos: 4, selection: { from: 0, to: 4 } },
      { id: 2, name: "هدهد", hue: 20, pos: 2 },
    ];
    mount({ value: "سلام دنیا", onChange, locale: "fa", remoteCursors: cursors });

    const carets = container.querySelectorAll(".cm-remote-caret");
    const flags = container.querySelectorAll(".cm-remote-caret-flag");
    const selections = container.querySelectorAll(".cm-remote-selection");

    expect(carets.length).toBe(2);
    expect(selections.length).toBe(1);
    expect(flags.length).toBe(2);
    expect(Array.from(flags).map((f) => f.textContent)).toEqual(
      expect.arrayContaining(["یوزپلنگ ایرانی", "هدهد"]),
    );

    // hue is the only permitted colour: each caret's colour must be set
    // (non-empty) and two different hues must not collapse to the same
    // colour.
    const colors = Array.from(carets).map((c) => (c as HTMLElement).style.borderInlineStartColor);
    for (const color of colors) expect(color).not.toBe("");
    expect(colors[0]).not.toBe(colors[1]);
  });

  it("updates remote cursor decorations when the remoteCursors prop changes", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    const first: RemoteCursor[] = [{ id: 1, name: "الف", hue: 10, pos: 1 }];
    const { rerender } = mount({ value: "سلام دنیا", onChange, locale: "fa", remoteCursors: first });
    expect(container.querySelectorAll(".cm-remote-caret").length).toBe(1);

    rerender({ value: "سلام دنیا", onChange, locale: "fa", remoteCursors: [] });
    expect(container.querySelectorAll(".cm-remote-caret").length).toBe(0);
  });
});
