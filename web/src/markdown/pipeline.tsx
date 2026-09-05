/**
 * The markdown render pipeline (PLAN.md §5.7): remark-parse -> remark-gfm ->
 * remark-math -> remark-rehype -> rehype-katex -> shiki -> React, via
 * react-markdown's own (synchronous) unified processor.
 *
 * Every plugin below is either a react-markdown-declared dependency
 * (remark-gfm, remark-math) or a small first-party function shaped like a
 * unified plugin (rehypeDirAuto, the detection plugin) — see ast.ts for why
 * this project never imports `unified`/`remark-parse`/`unist-util-visit`
 * directly.
 *
 * Lazy loading (task item 3): KaTeX only loads once an AST walk (detect.ts)
 * finds a math node, gating the `rehype-katex` entry in `rehypePlugins`
 * behind a piece of state that flips only after the dynamic import
 * resolves. Mermaid and shiki are lazier still — they're per-code-block
 * decisions made by the `pre` component override below, so a document with
 * ten code fences and one mermaid fence only ever loads mermaid for that
 * one block, and shiki loads only the languages actually fenced.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { PreviewProps } from "../views/types";
import { createDetectionResult, makeDetectPlugin, type DetectionResult } from "./detect";
import { loadKatexRehypePlugin } from "./katex";
import { MermaidBlock } from "./mermaid";
import { rehypeDirAuto } from "./rehypeDirAuto";
import { highlightCode } from "./shiki";
import { previewStrings } from "./strings";

import "./preview.css";

// A rehype-katex-shaped plugin, loaded lazily. We only need it structurally
// (a unified plugin function) — see katex.ts for the real type.
type KatexPlugin = Awaited<ReturnType<typeof loadKatexRehypePlugin>>;

function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return flattenText(element.props.children);
  }
  return "";
}

function useHighlightedHtml(code: string, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightCode(code, lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  return html;
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const html = useHighlightedHtml(code, lang);
  if (!html) {
    // Plain fallback while shiki (and/or this language's grammar) loads, or
    // if the fence names a language shiki doesn't bundle.
    return (
      <pre dir="ltr">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    // eslint-disable-next-line @typescript-eslint/naming-convention
    <div className="pmd-code-host" dir="ltr" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function extractCodeInfo(
  children: ReactNode,
): { lang: string | undefined; code: string } | undefined {
  const codeElement = Array.isArray(children) ? children[0] : children;
  if (
    codeElement === null ||
    typeof codeElement !== "object" ||
    !("props" in codeElement)
  ) {
    return undefined;
  }
  const element = codeElement as ReactElement<{ className?: string; children?: ReactNode }>;
  const match = /language-(\S+)/.exec(element.props.className ?? "");
  const lang = match?.[1]?.toLowerCase();
  const code = flattenText(element.props.children).replace(/\n$/, "");
  return { lang, code };
}

function makeComponents(locale: PreviewProps["locale"]): Components {
  return {
    pre({ node: _node, children, ...rest }) {
      void _node;
      const info = extractCodeInfo(children);
      if (!info?.lang) {
        return (
          <pre {...rest} dir="ltr">
            {children}
          </pre>
        );
      }
      if (info.lang === "mermaid") {
        return <MermaidBlock code={info.code} locale={locale} />;
      }
      return <HighlightedCode code={info.code} lang={info.lang} />;
    },
  };
}

/**
 * The read-only rendered preview. Implements `PreviewProps` (owned by the
 * integrator, views/types.ts) — do not add props here that aren't in that
 * contract; anything view-specific belongs in the caller (split view).
 */
export function Preview({
  markdown,
  locale,
  scrollFraction,
  onScrollFractionChange,
}: PreviewProps) {
  const strings = previewStrings[locale];

  // Fresh per markdown change; mutated in place by the detect plugin during
  // react-markdown's synchronous render below, read back in the effect.
  const detection = useMemo<DetectionResult>(() => createDetectionResult(), [markdown]);
  const detectPlugin = useMemo(() => makeDetectPlugin(detection), [detection]);

  const [katexPlugin, setKatexPlugin] = useState<KatexPlugin | null>(null);

  useEffect(() => {
    if (!detection.hasMath || katexPlugin) return;
    let cancelled = false;
    loadKatexRehypePlugin().then((plugin) => {
      if (!cancelled) setKatexPlugin(() => plugin);
    });
    return () => {
      cancelled = true;
    };
    // Only the *presence* of math (not the object identity of `detection`,
    // which is fresh every markdown change) should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.hasMath, katexPlugin]);

  const components = useMemo(() => makeComponents(locale), [locale]);

  // ---- Scroll sync (percentage-based, rAF-throttled) -------------------
  // Split view is the arbiter of *whether* to forward a scroll event (it
  // suppresses the pane that isn't hovered/focused so the two panes can't
  // feed each other into a loop); this component only has to be a faithful
  // two-way binding between its own scrollTop and a 0..1 fraction.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastAppliedFraction = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (scrollFraction === undefined) return;
    if (lastAppliedFraction.current === scrollFraction) return;
    const el = containerRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    lastAppliedFraction.current = scrollFraction;
    el.scrollTop = scrollFraction * max;
  }, [scrollFraction]);

  const handleScroll = () => {
    if (!onScrollFractionChange) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = containerRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const fraction = max <= 0 ? 0 : el.scrollTop / max;
      lastAppliedFraction.current = fraction;
      onScrollFractionChange(fraction);
    });
  };

  if (markdown.trim() === "") {
    return (
      <div ref={containerRef} className="pmd-preview" dir="auto" onScroll={handleScroll}>
        <p className="pmd-preview-empty">{strings.empty}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pmd-preview" dir="auto" onScroll={handleScroll}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, detectPlugin]}
        rehypePlugins={katexPlugin ? [rehypeDirAuto, katexPlugin] : [rehypeDirAuto]}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
