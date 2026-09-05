/**
 * Lazy KaTeX loading (PLAN.md §5.7, task item 3/4).
 *
 * `rehype-katex` and KaTeX's stylesheet (fonts included — self-hosted from
 * the npm package, never a CDN) are only reached through this function,
 * which the pipeline calls exactly when the AST-based detection in
 * detect.ts has found a math/inlineMath node. A document with no math never
 * calls this, and so never pays for either.
 *
 * The stylesheet import is a plain Vite CSS side-effect import: once the
 * dynamic `import()` resolves, Vite injects the stylesheet (and, via its
 * own `url()` rewriting, KaTeX's woff2 fonts as built assets) into the page.
 */

import type rehypeKatexDefault from "rehype-katex";

type RehypeKatexPlugin = typeof rehypeKatexDefault;

let pluginPromise: Promise<RehypeKatexPlugin> | null = null;

export function loadKatexRehypePlugin(): Promise<RehypeKatexPlugin> {
  if (!pluginPromise) {
    pluginPromise = Promise.all([import("rehype-katex"), import("katex/dist/katex.css")]).then(
      ([mod]) => mod.default,
    );
  }
  return pluginPromise;
}

/** Test-only: forces the next call to re-trigger the dynamic import. */
export function __resetKatexStateForTests(): void {
  pluginPromise = null;
}
