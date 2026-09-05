// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../markdown/testHelpers";
import { SplitView } from "./SplitView";

// SplitView renders Preview internally; keep math/mermaid out of these
// fixtures entirely so no lazy-loading machinery is involved here at all —
// that's covered exhaustively in markdown/pipeline.test.tsx.

function defineScrollBox(
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop = 0 }: { scrollHeight: number; clientHeight: number; scrollTop?: number },
): { get: () => number; set: (v: number) => void } {
  let top = scrollTop;
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  return {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  };
}

async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // one more microtask turn for the resulting state update to settle
    await Promise.resolve();
  });
}

const mounted: { unmount: () => Promise<void> }[] = [];
afterEach(async () => {
  while (mounted.length) {
    await mounted.pop()?.unmount();
  }
  vi.restoreAllMocks();
});

describe("SplitView", () => {
  it("renders the editor pane (children) before the splitter before the preview pane", async () => {
    const view = await mount(
      <SplitView markdown="# Title\n" locale="en">
        <div data-testid="editor-child">editor</div>
      </SplitView>,
    );
    mounted.push(view);
    const { container } = view;

    const root = container.querySelector(".pmd-split");
    expect(root).not.toBeNull();
    const kids = Array.from(root!.children);
    expect(kids[0]?.className).toContain("pmd-split__pane--editor");
    expect(kids[0]?.querySelector('[data-testid="editor-child"]')).not.toBeNull();
    expect(kids[1]?.getAttribute("role")).toBe("separator");
    expect(kids[2]?.className).toContain("pmd-split__pane--preview");
    expect(kids[2]?.querySelector(".pmd-preview")).not.toBeNull();
  });

  it("sets dir to match the locale", async () => {
    const en = await mount(
      <SplitView markdown="text" locale="en">
        <div />
      </SplitView>,
    );
    mounted.push(en);
    expect(en.container.querySelector(".pmd-split")?.getAttribute("dir")).toBe("ltr");

    const fa = await mount(
      <SplitView markdown="text" locale="fa">
        <div />
      </SplitView>,
    );
    mounted.push(fa);
    expect(fa.container.querySelector(".pmd-split")?.getAttribute("dir")).toBe("rtl");
  });

  it("drags the splitter to change the pane ratio, clamped to [0.15, 0.85]", async () => {
    const view = await mount(
      <SplitView markdown="text" locale="en">
        <div />
      </SplitView>,
    );
    mounted.push(view);
    const { container } = view;
    const root = container.querySelector(".pmd-split") as HTMLElement;
    const splitter = container.querySelector('[role="separator"]') as HTMLButtonElement;

    // jsdom never lays elements out, so getBoundingClientRect defaults to
    // all-zero; give the container a synthetic 400px-wide box.
    root.getBoundingClientRect = () =>
      ({ left: 0, right: 400, width: 400, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    splitter.setPointerCapture = vi.fn();
    splitter.hasPointerCapture = vi.fn(() => true);
    splitter.releasePointerCapture = vi.fn();

    await act(async () => {
      splitter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 300, pointerId: 1 }),
      );
    });

    // 300/400 = 0.75, within the clamp.
    expect(root.style.getPropertyValue("--pmd-split-a")).toBe("0.75fr");
    expect(root.style.getPropertyValue("--pmd-split-b")).toBe("0.25fr");

    await act(async () => {
      splitter.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: 396, pointerId: 1 }),
      );
    });
    // 396/400 = 0.99, clamped down to 0.85.
    expect(root.style.getPropertyValue("--pmd-split-a")).toBe("0.85fr");
  });

  it("nudges the ratio with the keyboard", async () => {
    const view = await mount(
      <SplitView markdown="text" locale="en">
        <div />
      </SplitView>,
    );
    mounted.push(view);
    const { container } = view;
    const root = container.querySelector(".pmd-split") as HTMLElement;
    const splitter = container.querySelector('[role="separator"]') as HTMLButtonElement;

    expect(root.style.getPropertyValue("--pmd-split-a")).toBe("0.5fr");
    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }));
    });
    expect(root.style.getPropertyValue("--pmd-split-a")).toBe("0.52fr");
  });

  it("forwards editor scroll to the preview pane only while the editor pane is active", async () => {
    const md = "line\n".repeat(80);
    const view = await mount(
      <SplitView markdown={md} locale="en">
        <div>
          <textarea data-testid="editor-input" />
          <div data-testid="scroller">content</div>
        </div>
      </SplitView>,
    );
    mounted.push(view);
    const { container } = view;

    const scroller = container.querySelector('[data-testid="scroller"]') as HTMLElement;
    defineScrollBox(scroller, { scrollHeight: 1000, clientHeight: 100 });

    const previewEl = container.querySelector(".pmd-preview") as HTMLElement;
    const previewBox = defineScrollBox(previewEl, { scrollHeight: 2000, clientHeight: 200 });

    // Not focused/hovered anywhere yet: scrolling the editor's inner
    // scroller must NOT move the preview.
    (scroller as unknown as { scrollTop: number }).scrollTop = 300;
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    await nextFrame();
    expect(previewBox.get()).toBe(0);

    // Focus something inside the editor pane -> it becomes the active pane.
    const input = container.querySelector('[data-testid="editor-input"]') as HTMLElement;
    await act(async () => {
      input.focus();
    });

    (scroller as unknown as { scrollTop: number }).scrollTop = 450;
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    await nextFrame();

    const expectedFraction = 450 / (1000 - 100);
    expect(previewBox.get()).toBeCloseTo(expectedFraction * (2000 - 200), 5);
  });
});
