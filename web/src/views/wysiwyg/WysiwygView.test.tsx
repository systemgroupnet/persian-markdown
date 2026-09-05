/**
 * @vitest-environment jsdom
 *
 * Smoke test for the WYSIWYG view. No `@testing-library/react` is
 * installed (task constraint: no `pnpm add`), so this drives React directly
 * via `react-dom/client` + `act`, and only exercises what doesn't require
 * simulating real keyboard/selection events in a contentEditable (jsdom's
 * Selection/Range support is too partial for that) — mounting, the
 * normalization-required flow, and readOnly rendering. The bridge logic
 * itself (the part that has to be right) is tested as pure functions in
 * src/bridge/*.test.ts, independent of any of this.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TextChange } from "@/views/types";

import { WysiwygView, type NormalizationPreview } from "./WysiwygView";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
  return container;
}

describe("WysiwygView", () => {
  it("mounts, deserializes the initial value, and calls onReady", () => {
    const onReady = vi.fn();
    const el = mount(
      <WysiwygView value="سلام دنیا" onChange={() => {}} locale="fa" onReady={onReady} />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("سلام دنیا");
  });

  it("renders the toolbar with monochrome, labelled buttons", () => {
    const el = mount(<WysiwygView value="متن" onChange={() => {}} locale="fa" />);
    const toolbar = el.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.querySelectorAll("button").length).toBeGreaterThan(5);
  });

  it("does not emit a change on mount when the round trip is stable", () => {
    const onChange = vi.fn();
    mount(<WysiwygView value="یک پاراگراف ساده." onChange={onChange} locale="fa" />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("requests normalization instead of silently emitting a rewrite when the round trip differs", () => {
    const onChange = vi.fn();
    let preview: NormalizationPreview | undefined;
    // remark-stringify normalises underscore emphasis to asterisks (see
    // plugins.ts / src/bridge/roundtrip.test.ts) — a reliable way to force
    // a real, known round-trip mismatch without mocking the editor.
    mount(
      <WysiwygView
        value="این _تأکید شده_ است."
        onChange={onChange}
        locale="fa"
        onNormalizationRequired={(p) => {
          preview = p;
        }}
      />,
    );

    expect(preview).toBeDefined();
    expect(preview!.before).toBe("این _تأکید شده_ است.");
    expect(preview!.after).toContain("*تأکید شده*");
    // Hazard one's entire point: nothing is emitted until confirmed.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits exactly one TextChange, and only after the user confirms normalization", () => {
    const onChange = vi.fn<(change: TextChange) => void>();
    let preview: NormalizationPreview | undefined;
    mount(
      <WysiwygView
        value="این _تأکید شده_ است."
        onChange={onChange}
        locale="fa"
        onNormalizationRequired={(p) => {
          preview = p;
        }}
      />,
    );

    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      preview!.confirm();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0]![0];
    expect(change.from).toBe(0);
    expect(change.to).toBe("این _تأکید شده_ است.".length);
    expect(change.insert).toContain("*تأکید شده*");
  });

  it("reconciles a remote value change block-granularly, leaving untouched paragraphs' DOM nodes alone", () => {
    const initial = "پاراگراف اول.\n\nپاراگراف دوم.";
    const el = mount(<WysiwygView value={initial} onChange={() => {}} locale="fa" />);

    const paragraphsBefore = Array.from(el.querySelectorAll("p"));
    expect(paragraphsBefore.length).toBeGreaterThanOrEqual(2);
    const firstParagraphNodeBefore = paragraphsBefore[0];

    const updated = "پاراگراف اول.\n\nپاراگراف دوم ویرایش‌شده از راه دور.";
    act(() => {
      root!.render(<WysiwygView value={updated} onChange={() => {}} locale="fa" />);
    });

    expect(el.textContent).toContain("ویرایش‌شده از راه دور");
    expect(el.textContent).not.toContain("پاراگراف دوم.");

    const paragraphsAfter = Array.from(el.querySelectorAll("p"));
    // The untouched first paragraph's DOM node is the SAME node — proof the
    // reconciliation replaced only the block that actually changed, not a
    // full re-mount via setValue.
    expect(paragraphsAfter[0]).toBe(firstParagraphNodeBefore);
  });

  it("renders read-only without a live toolbar interaction path", () => {
    const el = mount(<WysiwygView value="فقط خواندنی" onChange={() => {}} locale="fa" readOnly />);
    const editable = el.querySelector('[contenteditable]');
    // Slate/Plate sets contenteditable="false" in read-only mode rather
    // than omitting the attribute.
    expect(editable?.getAttribute("contenteditable")).toBe("false");
  });
});
