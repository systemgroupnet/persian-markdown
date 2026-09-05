// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

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

import { previewCss, renderToHtml } from "./renderToHtml";

describe("renderToHtml", () => {
  it("produces a self-contained fragment for plain markdown", async () => {
    const { html, usedKatex, usedMermaid } = await renderToHtml("# Hello\n\nA paragraph.\n");
    expect(usedKatex).toBe(false);
    expect(usedMermaid).toBe(false);
    expect(html).toContain('class="pmd-preview"');
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    // No script tags, no external network references anywhere.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("reports usedMermaid and inlines an <svg>", async () => {
    const { html, usedMermaid, usedKatex } = await renderToHtml(
      "```mermaid\ngraph TD; A-->B;\n```\n",
    );
    expect(usedMermaid).toBe(true);
    expect(usedKatex).toBe(false);
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/<script/i);
  });

  it("reports usedKatex and inlines KaTeX's stylesheet", async () => {
    const { html, usedKatex } = await renderToHtml("Inline math $x^2$.\n");
    expect(usedKatex).toBe(true);
    expect(html).toContain("<style>");
  });

  it("renders GFM tables with logical (start/end) cell alignment", async () => {
    const { html } = await renderToHtml("| A | B |\n|:--|--:|\n| 1 | 2 |\n");
    expect(html).toContain("<table");
    expect(html).toContain("text-align:start");
    expect(html).toContain("text-align:end");
  });

  it("renders Persian content without throwing", async () => {
    const { html } = await renderToHtml("# سلام دنیا\n\nمتنی با می‌روم در آن.\n");
    expect(html).toContain("سلام");
    expect(html).toContain('dir="auto"');
  });

  it("exports a non-empty previewCss stylesheet string", () => {
    expect(typeof previewCss).toBe("string");
    expect(previewCss).toContain(":root");
    expect(previewCss).toContain("--foreground");
  });
});
