import { describe, expect, it } from "vitest";

import { buildStandaloneHtml } from "./standaloneHtml";

const EXTERNAL_REF = /\b(?:src|href)\s*=\s*["'](https?:)?\/\//i;

describe("buildStandaloneHtml", () => {
  it("produces a doctype+html document with the expected shell", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<h1>سلام دنیا</h1>",
      css: "body{color:red}",
      title: "سند من",
      locale: "fa",
      embedFont: false,
    });

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain('<body dir="auto">');
    expect(html).toContain("<h1>سلام دنیا</h1>");
    expect(html).toContain("body{color:red}");
    expect(html).toContain("<title>سند من</title>");
  });

  it("sets ltr direction for the English locale", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<p>hello</p>",
      css: "",
      title: "My document",
      locale: "en",
      embedFont: false,
    });
    expect(html).toContain('<html lang="en" dir="ltr">');
  });

  it("has no external network references (no http(s) src/href for scripts, styles, or fonts)", () => {
    const html = buildStandaloneHtml({
      bodyHtml: '<img src="cid:local"><a href="#anchor">x</a>',
      css: "body{font-family:sans-serif}",
      title: "test",
      locale: "en",
      embedFont: true,
      fontDataUrl: "data:font/woff2;base64,AAAA",
    });

    expect(EXTERNAL_REF.test(html)).toBe(false);
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/i);
  });

  it("inlines the font as a data: URL when embedFont is on and a data URL is provided", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<p>x</p>",
      css: "",
      title: "t",
      locale: "en",
      embedFont: true,
      fontDataUrl: "data:font/woff2;base64,AAAA",
    });
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/woff2;base64,AAAA");
  });

  it("falls back to a system font stack when embedFont is off or no data URL was produced", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<p>x</p>",
      css: "",
      title: "t",
      locale: "en",
      embedFont: true, // requested, but the fetch failed upstream
    });
    expect(html).not.toContain("@font-face");
    expect(html).toMatch(/font-family:[^;]*sans-serif/);
  });

  it("neutralizes a literal </style> sequence inside the css string", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<p>x</p>",
      css: "body{content:'</style><script>alert(1)</script>'}",
      title: "t",
      locale: "en",
      embedFont: false,
    });
    // The style block must still be well-formed: exactly the two <style>
    // tags we generated, nothing broken out by the CSS text.
    const styleOpenCount = (html.match(/<style>/gi) ?? []).length;
    const styleCloseCount = (html.match(/<\/style>/gi) ?? []).length;
    expect(styleOpenCount).toBe(1);
    expect(styleCloseCount).toBe(1);
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("escapes the title for safe placement in <title>", () => {
    const html = buildStandaloneHtml({
      bodyHtml: "<p>x</p>",
      css: "",
      title: "</title><script>alert(1)</script>",
      locale: "en",
      embedFont: false,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
