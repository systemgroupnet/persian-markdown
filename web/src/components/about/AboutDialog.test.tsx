// @vitest-environment jsdom
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AboutDialog } from "./AboutDialog";

// Silences React's "not configured to support act(...)" warning — this is
// a real DOM test harness (jsdom + createRoot + act), just without
// @testing-library/react's setup shimming this global for us.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

function renderDialog(props: Partial<ComponentProps<typeof AboutDialog>> = {}): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AboutDialog
        open
        onOpenChange={() => {}}
        version="1.2.3"
        commit="abc1234"
        locale="fa"
        {...props}
      />,
    );
  });
}

describe("AboutDialog", () => {
  it("renders the MIT/systemgroupnet attribution with a repository link", () => {
    renderDialog();
    const repoLink = document.body.querySelector('a[href="https://github.com/systemgroupnet"]');
    expect(repoLink).not.toBeNull();
    expect(document.body.textContent).toContain("systemgroupnet");
    expect(document.body.textContent).toMatch(/MIT/);
  });

  it("renders the injected version and commit (never invented)", () => {
    renderDialog({ version: "9.9.9", commit: "deadbee" });
    expect(document.body.textContent).toContain("9.9.9");
    expect(document.body.textContent).toContain("deadbee");
  });

  it("renders the Vazirmatn SIL OFL attribution with a link", () => {
    renderDialog();
    expect(document.body.textContent).toMatch(/Open Font License|وزیرمتن/);
    const fontLink = document.body.querySelector(
      'a[href="https://github.com/rastikerdar/vazirmatn"]',
    );
    expect(fontLink).not.toBeNull();
  });

  it("credits Rustpad for the collaboration design, with a link", () => {
    renderDialog();
    expect(document.body.textContent).toMatch(/Rustpad/);
    const rustpadLink = document.body.querySelector('a[href="https://github.com/ekzhang/rustpad"]');
    expect(rustpadLink).not.toBeNull();
  });

  it("states plainly that rooms are unlisted/unguessable but NOT secret", () => {
    renderDialog();
    expect(document.body.textContent).toContain("محرمانه نیست");
  });

  it("states the same privacy notice in English", () => {
    renderDialog({ locale: "en" });
    expect(document.body.textContent).toMatch(/not secret/i);
    expect(document.body.textContent).toMatch(/no accounts/i);
  });

  it('wraps every external link in dir="ltr" so the Latin URL does not reorder in RTL', () => {
    renderDialog();
    const links = Array.from(document.body.querySelectorAll("a[href^='http']"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("dir")).toBe("ltr");
    }
  });

  it("keeps every link keyboard accessible with a visible focus style", () => {
    renderDialog();
    const links = Array.from(document.body.querySelectorAll("a[href^='http']"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("tabindex")).not.toBe("-1");
      expect(link.className).toMatch(/focus-visible/);
    }
  });

  it("renders no emoji characters anywhere in the dialog", () => {
    renderDialog();
    const text = document.body.textContent ?? "";
    // Broad emoji/pictograph ranges; the design system bans emoji entirely.
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(text)).toBe(false);
  });

  it("renders correctly in English", () => {
    renderDialog({ locale: "en" });
    expect(document.body.textContent).toContain("Persian Markdown Editor");
  });
});
