/**
 * Ambient module declarations for Vite asset imports used by this package.
 *
 * There's no project-wide `vite-env.d.ts` (nothing under web/ references
 * `vite/client`), so a *bound* CSS import — `import x from "./f.css"` or a
 * dynamic `import("./f.css")` used for its resolved value rather than only
 * its side effect — has no type to resolve to. Bare, binding-less side
 * effect imports (`import "./f.css";`) don't need this: TypeScript doesn't
 * type-check the target of an import declaration that introduces no
 * bindings, only calls to `import()` and imports with a name do.
 *
 * `*.css` — Vite's normal stylesheet import; in a browser it's a side
 * effect (injects/updates a <link>/<style>), which is exactly how the live
 * Preview lazy-loads KaTeX's stylesheet (`await import("katex/dist/katex.css")`
 * only once a math node is detected).
 *
 * `*.css?raw` — Vite's raw-text loader: the file's contents as a plain
 * string, resolved at build time. Used to extract `preview.css` into the
 * `previewCss` string the HTML export inlines.
 */
declare module "*.css" {
  const url: string;
  export default url;
}

declare module "*.css?raw" {
  const css: string;
  export default css;
}
