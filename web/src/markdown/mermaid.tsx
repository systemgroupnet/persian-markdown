/**
 * Lazy Mermaid loading + rendering (PLAN.md §5.7, task items 3/5).
 *
 * `mermaid` (~1MB) is only reached through `renderMermaidToSvg`, called by
 * `<MermaidBlock>` — which the render pipeline only mounts for a fenced
 * code block whose language is exactly `mermaid`. A document without one
 * never triggers the dynamic import.
 *
 * Monochrome: `theme: "base"` plus a `themeVariables` map pointed at the
 * app's own neutral CSS custom properties (`var(--foreground)`, etc.)
 * rather than literal colors. Mermaid interpolates these strings verbatim
 * into a `<style>` block embedded in the SVG it returns; since that SVG
 * stays part of the live document, `var(--foreground)` resolves against
 * the real page (and so tracks light/dark automatically). The HTML export
 * path re-declares the same token names in its own inlined stylesheet
 * (see renderToHtml.ts) so exported diagrams keep working standalone.
 *
 * Stable ids: the SVG element id mermaid mints is derived from a hash of
 * the diagram source, not a render counter, so the same diagram always
 * gets the same id and re-rendering an unrelated part of the document
 * never disturbs diagrams whose source didn't change (also enforced by
 * keying the `useEffect` below on `code` itself).
 */

import { useEffect, useState } from "react";
import type { Locale } from "../views/types";
import { previewStrings } from "./strings";

type MermaidModule = typeof import("mermaid")["default"];

let mermaidPromise: Promise<MermaidModule> | null = null;

function hashCode(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

async function getMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        themeVariables: {
          background: "var(--background)",
          primaryColor: "var(--muted)",
          primaryTextColor: "var(--foreground)",
          primaryBorderColor: "var(--border)",
          secondaryColor: "var(--muted)",
          secondaryTextColor: "var(--foreground)",
          secondaryBorderColor: "var(--border)",
          tertiaryColor: "var(--muted)",
          tertiaryTextColor: "var(--foreground)",
          tertiaryBorderColor: "var(--border)",
          lineColor: "var(--border)",
          textColor: "var(--foreground)",
          mainBkg: "var(--muted)",
          nodeBorder: "var(--border)",
          nodeTextColor: "var(--foreground)",
          clusterBkg: "var(--background)",
          clusterBorder: "var(--border)",
          titleColor: "var(--foreground)",
          edgeLabelBackground: "var(--background)",
          actorBkg: "var(--muted)",
          actorBorder: "var(--border)",
          actorTextColor: "var(--foreground)",
          actorLineColor: "var(--border)",
          signalColor: "var(--foreground)",
          signalTextColor: "var(--foreground)",
          labelBoxBkgColor: "var(--muted)",
          labelBoxBorderColor: "var(--border)",
          labelTextColor: "var(--foreground)",
          noteBkgColor: "var(--muted)",
          noteBorderColor: "var(--border)",
          noteTextColor: "var(--foreground)",
          errorBkgColor: "var(--muted)",
          errorTextColor: "var(--foreground)",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

/** Renders one mermaid diagram source to an SVG string. Throws on parse error. */
export async function renderMermaidToSvg(code: string): Promise<MermaidRenderResult> {
  const mermaid = await getMermaid();
  const id = `pmd-mermaid-${hashCode(code)}`;
  const result = await mermaid.render(id, code);
  return result;
}

/** Test-only: forces the next render to re-trigger the dynamic import. */
export function __resetMermaidStateForTests(): void {
  mermaidPromise = null;
}

type MermaidState =
  | { status: "loading" }
  | { status: "ready"; result: MermaidRenderResult }
  | { status: "error"; message: string };

export function MermaidBlock({ code, locale }: { code: string; locale: Locale }) {
  const [state, setState] = useState<MermaidState>({ status: "loading" });
  const strings = previewStrings[locale];

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    renderMermaidToSvg(code)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === "ready") {
    return (
      <div
        className="pmd-mermaid"
        dir="ltr"
        ref={(el) => {
          if (el) state.result.bindFunctions?.(el);
        }}
        // eslint-disable-next-line @typescript-eslint/naming-convention
        dangerouslySetInnerHTML={{ __html: state.result.svg }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <div className="pmd-mermaid pmd-mermaid--error" dir="ltr" role="alert">
        <p className="pmd-mermaid__message">{strings.mermaidError}</p>
        <pre className="pmd-mermaid__source">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      className="pmd-mermaid pmd-mermaid--loading"
      dir="ltr"
      role="status"
      aria-label={strings.mermaidLoading}
    >
      <span className="pmd-mermaid__placeholder-bar" />
      <span className="pmd-mermaid__placeholder-bar" />
      <span className="pmd-mermaid__placeholder-bar" />
    </div>
  );
}
