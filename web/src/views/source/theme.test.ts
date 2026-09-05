// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createEditorTheme } from "./theme";

/**
 * Guards the two mistakes that made text selection invisible in the editor,
 * neither of which any behavioural test could catch: both produced a perfectly
 * functional selection that simply could not be seen.
 */

let view: EditorView | null = null;

function mount(): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc: "سلام دنیا", extensions: [createEditorTheme()] }),
    parent: document.body,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

function rulesMatching(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      const text = (rule as CSSStyleRule).cssText ?? "";
      if (pattern.test(text)) out.push(text);
    }
  }
  return out;
}

describe("editor selection visibility", () => {
  it("matches CodeMirror's own selector depth so its default cannot win", () => {
    mount();

    const ours = rulesMatching(/cm-selectionBackground/).filter((r) =>
      r.includes("--selection"),
    );
    expect(ours.length, "no selection rule referencing --selection was emitted").toBeGreaterThan(0);

    // CodeMirror's built-in rule is
    //   .ͼ2.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
    // Five classes. A shorter selector loses on specificity and the colour set
    // here is silently discarded, which is exactly what happened before.
    const deepEnough = ours.some(
      (r) => r.includes(".cm-selectionLayer") && r.includes(".cm-scroller"),
    );
    expect(
      deepEnough,
      "selection rule must go through .cm-scroller > .cm-selectionLayer to match " +
        "the specificity of CodeMirror's default, otherwise the default wins",
    ).toBe(true);
  });

  it("keeps the active line translucent so it cannot cover the selection", () => {
    mount();

    // Only our own rules: CodeMirror's built-in default is also present and
    // uses a literal colour. Notably its default is rgba(...,0.267) — already
    // translucent, for exactly the reason asserted below.
    const activeLine = rulesMatching(/\.cm-activeLine\s*\{/).filter((r) => r.includes("var(--"));
    expect(activeLine.length, "no .cm-activeLine rule of ours was emitted").toBeGreaterThan(0);

    // .cm-selectionLayer sits at z-index -2, behind the line content, so an
    // opaque active-line background hides the selection on the very line the
    // user is editing. --active-line is defined as a color-mix with
    // transparent; --muted and the other ramp tokens are fully opaque.
    const opaqueTokens = ["var(--muted)", "var(--accent)", "var(--background)", "var(--border)"];
    for (const rule of activeLine) {
      for (const token of opaqueTokens) {
        expect(
          rule.includes(token),
          `.cm-activeLine must not use the opaque ${token}; it would paint over the selection`,
        ).toBe(false);
      }
      expect(rule).toContain("var(--active-line)");
    }
  });
});
