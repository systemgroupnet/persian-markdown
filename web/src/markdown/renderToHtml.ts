/**
 * HTML export (PLAN.md §6, task item 6).
 *
 * Produced client-side, using the exact same pipeline as the live preview
 * (react-markdown + our plugins) — running it a second time in Go would
 * mean two renderers that have to agree. `ReactDOMServer.renderToStaticMarkup`
 * runs entirely in-memory (no real DOM needed), which is what lets this
 * function work as a plain async function rather than a component.
 *
 * This file is intentionally `.ts`, not `.tsx` (matching the exact filename
 * asked for), so it builds elements with `createElement` rather than JSX —
 * functionally identical, just without JSX syntax.
 *
 * Unlike the live Preview, this output has to be a single, final string —
 * there's no commit-then-effect cycle to lazily resolve KaTeX/Mermaid across
 * renders. So this does two passes:
 *
 *   1. A cheap "detect" pass (react-markdown + the same AST walk detect.ts
 *      uses for the live preview) that finds every math node, every fenced
 *      code block's (lang, code), and every mermaid block's source. Its own
 *      HTML output is discarded.
 *   2. Everything those findings need is awaited up front (the katex rehype
 *      plugin, shiki HTML per distinct (lang, code) pair, an SVG per
 *      distinct mermaid source) into plain lookup maps, and a second,
 *      fully-resolved render produces the final string synchronously.
 */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { createDetectionResult, makeDetectPlugin } from "./detect";
import { loadKatexRehypePlugin } from "./katex";
import { renderMermaidToSvg } from "./mermaid";
import { rehypeDirAuto } from "./rehypeDirAuto";
import { highlightCode } from "./shiki";

import previewCssBody from "./preview.css?raw";
import katexCss from "katex/dist/katex.css?raw";

/**
 * A small, duplicated copy of the light-mode neutral tokens from
 * web/src/styles/theme.css (light values only — an exported file is a
 * static artifact, it doesn't need a live dark-mode toggle). Duplicated
 * rather than imported deliberately: this module must produce a
 * self-contained string with no runtime dependency on the app shell's own
 * stylesheet being present in whatever document the caller assembles.
 * PLAN.md §11 documents the same tradeoff for the landing site's CSS.
 */
const EXPORT_ROOT_TOKENS =
  ":root{--background:#fcfcfc;--foreground:#292929;--border:#dedede;--muted:#f4f4f4;--muted-foreground:#767676;--radius:2px}";

/** The rendered-markdown stylesheet, for the HTML export to inline. */
export const previewCss = `${EXPORT_ROOT_TOKENS}\n${previewCssBody}`;

function codeBlockKey(lang: string, code: string): string {
  return `${lang} ${code}`;
}

function flattenText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "props" in (node as object)) {
    return flattenText((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function extractCodeInfo(
  children: unknown,
): { lang: string | undefined; code: string } | undefined {
  const codeElement = Array.isArray(children) ? children[0] : children;
  if (
    codeElement === null ||
    typeof codeElement !== "object" ||
    !("props" in (codeElement as object))
  ) {
    return undefined;
  }
  const props = (codeElement as { props: { className?: string; children?: unknown } }).props;
  const match = /language-(\S+)/.exec(props.className ?? "");
  const lang = match?.[1]?.toLowerCase();
  const code = flattenText(props.children).replace(/\n$/, "");
  return { lang, code };
}

/** Plain `<pre dir="ltr"><code>…</code></pre>` fallback. */
function plainCode(code: string): ReactNode {
  return createElement("pre", { dir: "ltr" }, createElement("code", null, code));
}

function rawHtmlBlock(className: string, html: string): ReactNode {
  return createElement("div", {
    className,
    dir: "ltr",
    dangerouslySetInnerHTML: { __html: html },
  });
}

export interface RenderToHtmlResult {
  /**
   * A self-contained `<div class="pmd-preview" dir="auto">…</div>` fragment
   * — mermaid diagrams already serialized as inline `<svg>`, math already
   * KaTeX's rendered HTML, and (when math was used) KaTeX's own stylesheet
   * inlined in a `<style>` tag ahead of it. No scripts, no network
   * requests.
   */
  html: string;
  usedKatex: boolean;
  usedMermaid: boolean;
}

export async function renderToHtml(markdown: string): Promise<RenderToHtmlResult> {
  const detection = createDetectionResult();
  const detectPlugin = makeDetectPlugin(detection);

  // Pass 1: detect only. Output discarded — react-markdown needs to run to
  // build the mdast tree the detect plugin walks, but nothing here should
  // trigger a katex/mermaid/shiki load yet.
  renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm, remarkMath, detectPlugin],
      rehypePlugins: [rehypeDirAuto],
      children: markdown,
    }),
  );

  const usedKatex = detection.hasMath;
  const usedMermaid = detection.mermaidBlocks.length > 0;

  const [katexPlugin, shikiMap, mermaidMap] = await Promise.all([
    usedKatex ? loadKatexRehypePlugin() : Promise.resolve(null),
    (async () => {
      const map = new Map<string, string | null>();
      const unique = new Map(detection.codeBlocks.map((b) => [codeBlockKey(b.lang, b.code), b]));
      await Promise.all(
        Array.from(unique.entries()).map(async ([key, block]) => {
          map.set(key, await highlightCode(block.code, block.lang));
        }),
      );
      return map;
    })(),
    (async () => {
      const map = new Map<string, string>();
      const unique = Array.from(new Set(detection.mermaidBlocks));
      await Promise.all(
        unique.map(async (code) => {
          try {
            const result = await renderMermaidToSvg(code);
            map.set(code, result.svg);
          } catch {
            // Left out of the map; the final pass falls back to the raw
            // source rather than failing the whole export over one bad
            // diagram.
          }
        }),
      );
      return map;
    })(),
  ]);

  const components: Components = {
    pre({ node: _node, children }) {
      void _node;
      const info = extractCodeInfo(children);
      if (!info?.lang) return plainCode(flattenText(children));
      if (info.lang === "mermaid") {
        const svg = mermaidMap.get(info.code);
        return svg ? rawHtmlBlock("pmd-mermaid", svg) : plainCode(info.code);
      }
      const highlighted = shikiMap.get(codeBlockKey(info.lang, info.code));
      return highlighted ? rawHtmlBlock("pmd-code-host", highlighted) : plainCode(info.code);
    },
  };

  const body = renderToStaticMarkup(
    createElement(
      "div",
      { className: "pmd-preview", dir: "auto" },
      createElement(
        Markdown,
        {
          remarkPlugins: [remarkGfm, remarkMath],
          rehypePlugins: katexPlugin ? [rehypeDirAuto, katexPlugin] : [rehypeDirAuto],
          components,
        },
        markdown,
      ),
    ),
  );

  const html = usedKatex ? `<style>${katexCss}</style>\n${body}` : body;

  return { html, usedKatex, usedMermaid };
}
