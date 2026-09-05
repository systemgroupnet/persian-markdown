import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import { wysiwygPlugins } from "@/views/wysiwyg/plugins";

import { reconcileRemoteValue } from "./apply-reconciliation";

function p(text: string) {
  return { type: "p", children: [{ text }] };
}

function makeEditor(initial: ReturnType<typeof p>[]) {
  return createSlateEditor({ plugins: wysiwygPlugins, value: initial });
}

describe("reconcileRemoteValue", () => {
  it("replaces only the changed block when the caret is elsewhere", () => {
    const editor = makeEditor([p("first"), p("second"), p("third")]);
    editor.tf.select({ path: [0, 0], offset: 0 }); // caret in block 0

    reconcileRemoteValue(editor, [p("first"), p("SECOND EDITED REMOTELY"), p("third")]);

    expect(editor.children).toEqual([p("first"), p("SECOND EDITED REMOTELY"), p("third")]);
  });

  it("leaves the block containing the caret untouched even if the incoming value changed it too", () => {
    const editor = makeEditor([p("first"), p("second"), p("third")]);
    editor.tf.select({ path: [1, 0], offset: 3 }); // caret inside block 1 ("second")

    // A remote edit that (from the server's perspective) also touched block
    // 1 — e.g. two people typing in the same paragraph at once.
    reconcileRemoteValue(editor, [p("first"), p("second REMOTELY CHANGED"), p("third")]);

    // Block 1 is left exactly as the local editor had it; blocks 0 and 2
    // (identical anyway) are unaffected either way.
    expect(editor.children).toEqual([p("first"), p("second"), p("third")]);
  });

  it("preserves the local selection across a block-granular reconciliation", () => {
    const editor = makeEditor([p("first"), p("second"), p("third")]);
    editor.tf.select({ path: [0, 0], offset: 2 }); // caret at offset 2 in block 0, untouched by the edit

    reconcileRemoteValue(editor, [p("first"), p("SECOND EDITED"), p("third")]);

    expect(editor.selection).toEqual({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    });
  });

  it("is a no-op when the incoming value is identical", () => {
    const editor = makeEditor([p("first"), p("second")]);
    const before = editor.children;
    reconcileRemoteValue(editor, [p("first"), p("second")]);
    expect(editor.children).toBe(before); // same array reference — nothing touched it
  });

  it("falls back to a full replace when the block count changed (structural edit)", () => {
    const editor = makeEditor([p("first"), p("second")]);
    editor.tf.select({ path: [0, 0], offset: 0 });

    reconcileRemoteValue(editor, [p("first"), p("inserted in the middle"), p("second")]);

    expect(editor.children).toEqual([p("first"), p("inserted in the middle"), p("second")]);
  });

  it("never lets a reconciled remote edit land on the local undo stack", () => {
    const editor = makeEditor([p("first"), p("second")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    editor.tf.insertText("X"); // a real local edit, which DOES enter history

    const historyLengthAfterLocalEdit = (editor as unknown as { history: { undos: unknown[] } }).history.undos.length;
    expect(historyLengthAfterLocalEdit).toBeGreaterThan(0);

    reconcileRemoteValue(editor, [p("Xfirst"), p("second REMOTELY CHANGED")]);

    const historyLengthAfterRemoteReconcile = (editor as unknown as { history: { undos: unknown[] } }).history.undos
      .length;
    expect(historyLengthAfterRemoteReconcile).toBe(historyLengthAfterLocalEdit);
  });
});
