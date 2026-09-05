// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "./pipeline";
import { flush, mount, waitFor } from "./testHelpers";

// Mock the actual *third-party* packages our lazy loaders reach for
// (rather than our own katex.ts/mermaid.tsx wrappers) — MermaidBlock calls
// renderMermaidToSvg via a same-module closure, which a mock of our own
// wrapper's export wouldn't intercept. Mocking "mermaid"/"rehype-katex"
// themselves works regardless, and doubles as the "was the heavy
// dependency ever reached" signal the lazy-loading requirement cares
// about.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, code: string) => ({
      svg: `<svg data-mock-mermaid-id="${id}">${code}</svg>`,
    })),
  },
}));

vi.mock("rehype-katex", () => ({
  default: vi.fn(() => (tree: unknown) => tree),
}));

import mermaid from "mermaid";
import rehypeKatex from "rehype-katex";

const mockedMermaidRender = vi.mocked(mermaid.render);
const mockedRehypeKatex = vi.mocked(rehypeKatex);

beforeEach(() => {
  mockedMermaidRender.mockClear();
  mockedRehypeKatex.mockClear();
});

describe("Preview", () => {
  it("renders a GFM table", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="en" />);
    expect(container.querySelectorAll("table").length).toBe(1);
    expect(container.querySelectorAll("td").length).toBe(2);
    await unmount();
  });

  it("renders a GFM task list with checkboxes", async () => {
    const md = "- [x] done\n- [ ] todo\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="en" />);
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    await unmount();
  });

  it("puts dir=auto on block-level elements", async () => {
    const md = "# Heading\n\nA paragraph.\n\n- an item\n\n> a quote\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="en" />);
    expect(container.querySelector("h1")?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector("p")?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector("li")?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector("blockquote")?.getAttribute("dir")).toBe("auto");
    await unmount();
  });

  it("forces dir=ltr on inline code and fenced code", async () => {
    const md = "Some `inline code` here.\n\n```text\nplain fence\n```\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="en" />);
    await flush();
    expect(container.querySelector("code")?.getAttribute("dir")).toBe("ltr");
    // The fenced block (no known shiki grammar needed for "text") renders
    // as a plain <pre dir="ltr">.
    expect(container.querySelector("pre")?.getAttribute("dir")).toBe("ltr");
    await unmount();
  });

  it("does NOT load KaTeX for a document with no math", async () => {
    const md = "# Title\n\nJust a paragraph, no math at all.\n";
    const { unmount } = await mount(<Preview markdown={md} locale="en" />);
    await flush();
    expect(mockedRehypeKatex).not.toHaveBeenCalled();
    await unmount();
  });

  it("loads KaTeX only once a math node is present", async () => {
    const md = "Inline math $x^2$ here.\n";
    const { unmount } = await mount(<Preview markdown={md} locale="en" />);
    await waitFor(() => mockedRehypeKatex.mock.calls.length > 0);
    expect(mockedRehypeKatex).toHaveBeenCalled();
    await unmount();
  });

  it("does NOT load mermaid for a document with no mermaid fence", async () => {
    const md = "```js\nconst x = 1;\n```\n";
    const { unmount } = await mount(<Preview markdown={md} locale="en" />);
    await flush();
    expect(mockedMermaidRender).not.toHaveBeenCalled();
    await unmount();
  });

  it("loads mermaid only for a ```mermaid fence and renders its svg", async () => {
    const md = "```mermaid\ngraph TD; A-->B;\n```\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="en" />);
    await waitFor(() => container.querySelector("svg[data-mock-mermaid-id]") !== null);
    expect(mockedMermaidRender).toHaveBeenCalled();
    expect(container.querySelector("svg[data-mock-mermaid-id]")).not.toBeNull();
    await unmount();
  });

  it("renders Persian content without throwing", async () => {
    const md = "# سلام دنیا\n\nاین یک متن فارسی با کلمه‌ی می‌روم (نیم‌فاصله) است.\n";
    const { container, unmount } = await mount(<Preview markdown={md} locale="fa" />);
    expect(container.querySelector("h1")?.textContent).toContain("سلام");
    expect(container.querySelector("h1")?.getAttribute("dir")).toBe("auto");
    await unmount();
  });

  it("renders mixed-direction (Persian + English + code) content without throwing", async () => {
    const md = [
      "# عنوان mixed Title",
      "",
      "این یک جمله با یک دستور `git status` در وسط آن است.",
      "",
      "| نام | Name |",
      "|---|---|",
      "| علی | Ali |",
    ].join("\n");
    const { container, unmount } = await mount(<Preview markdown={md} locale="fa" />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("code")?.getAttribute("dir")).toBe("ltr");
    await unmount();
  });

  it("shows the empty-state placeholder for blank markdown", async () => {
    const { container, unmount } = await mount(<Preview markdown="" locale="en" />);
    expect(container.querySelector(".pmd-preview-empty")).not.toBeNull();
    await unmount();
  });
});
