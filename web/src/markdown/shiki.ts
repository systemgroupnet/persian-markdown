/**
 * Lazy, monochrome syntax highlighting.
 *
 * `shiki` (the whole module, including its wasm-free grammar/theme chunks)
 * is only ever reached through a dynamic `import("shiki")`, gated on the
 * document actually containing a fenced code block (checked via the AST —
 * see detect.ts). A plain prose document never pays for it.
 *
 * Monochrome theme: rather than a real color theme (which would introduce
 * hue), we build a theme with shiki's own `createCssVariablesTheme` — every
 * token category becomes a `var(--pmd-shiki-token-*)` reference instead of a
 * hardcoded hex. `preview.css` binds those variables to the app's existing
 * neutral `--foreground`/`--muted-foreground` tokens (so highlighting stays
 * correct across light/dark for free) and layers font-weight/opacity rules
 * on top via `[style*="token-..."]` attribute selectors, which work because
 * shiki writes the variable name verbatim into the `style` attribute. Tokens
 * are told apart by weight and opacity, never by hue.
 */

import type { Highlighter } from "shiki";

export const SHIKI_THEME_NAME = "pmd-mono";

/**
 * The grammars we ship, as explicit static import specifiers.
 *
 * This map is load-bearing for bundle size, not just taste. Passing a runtime
 * string to `highlighter.loadLanguage(lang)` makes the bundler assume ANY of
 * shiki's ~200 grammars might be needed, so it emits a chunk for every one of
 * them — the first build of this app produced 372 chunks and an 18 MB dist,
 * including grammars for Wolfram and Emacs Lisp. Naming the specifiers
 * statically lets the bundler emit only these.
 *
 * Each entry is still a separate lazy chunk: a document with one ```go fence
 * downloads the Go grammar and nothing else. An unlisted language is not an
 * error — the caller degrades to an unhighlighted `<pre>`, which is a perfectly
 * good rendering of code.
 */
const GRAMMARS = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} satisfies Record<string, () => Promise<unknown>>;

/** Info-string spellings people actually type, mapped to a grammar above. */
const ALIASES: Record<string, keyof typeof GRAMMARS> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  golang: "go",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "html",
} as Record<string, keyof typeof GRAMMARS>;

function resolveGrammar(lang: string): keyof typeof GRAMMARS | null {
  if (lang in GRAMMARS) return lang as keyof typeof GRAMMARS;
  const alias = ALIASES[lang];
  return alias && alias in GRAMMARS ? alias : null;
}

let highlighterPromise: Promise<Highlighter> | null = null;
const unsupportedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    /*
     * `shiki/core` rather than `shiki`.
     *
     * The `shiki` entry point IS the full bundle: its registry statically
     * references every grammar it ships, so merely importing it makes the
     * bundler emit a chunk per language regardless of which ones we ever ask
     * for. That is what produced 372 chunks and an 18 MB dist. `shiki/core`
     * carries no registry, so only the grammars named in GRAMMARS above are
     * emitted.
     *
     * The oniguruma engine is used over the pure-JS one because it is the
     * reference implementation for TextMate grammars; its wasm payload is a
     * lazy chunk reached only when a document actually contains code.
     */
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/oniguruma"),
    ]).then(async ([core, oniguruma]) => {
      const theme = core.createCssVariablesTheme({
        name: SHIKI_THEME_NAME,
        variablePrefix: "--pmd-shiki-",
        fontStyle: true,
      });
      return core.createHighlighterCore({
        themes: [theme],
        langs: [],
        engine: oniguruma.createOnigurumaEngine(() => import("shiki/wasm")),
      }) as unknown as Highlighter;
    });
  }
  return highlighterPromise;
}

async function ensureLang(lang: string): Promise<boolean> {
  if (unsupportedLangs.has(lang)) return false;

  const grammar = resolveGrammar(lang);
  if (!grammar) {
    unsupportedLangs.add(lang);
    return false;
  }

  const highlighter = await getHighlighter();
  if (highlighter.getLoadedLanguages().includes(grammar)) return true;

  let pending = loadingLangs.get(grammar);
  if (!pending) {
    pending = GRAMMARS[grammar]()
      .then(async (mod) => {
        const registration = (mod as { default: unknown }).default;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await highlighter.loadLanguage(registration as any);
      })
      .catch(() => {
        unsupportedLangs.add(grammar);
      });
    loadingLangs.set(grammar, pending);
  }
  await pending;
  return !unsupportedLangs.has(grammar);
}

/** The grammar an info string resolves to, or null. Exported for tests. */
export function grammarFor(lang: string): string | null {
  return resolveGrammar(lang.trim().toLowerCase());
}

/**
 * Highlights one code block. Returns the shiki-produced HTML string (a full
 * `<pre class="shiki ...">…</pre>`), or `null` if the language isn't one
 * shiki bundles (unknown/made-up info strings degrade to plain `<pre>`
 * rendering by the caller) or hasn't finished loading yet.
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const normalized = lang.trim().toLowerCase();
  if (!normalized) return null;
  const ok = await ensureLang(normalized);
  if (!ok) return null;
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, { lang: normalized, theme: SHIKI_THEME_NAME });
}

/** Test-only: forces the next `getHighlighter()`/`highlightCode()` call to reload. */
export function __resetShikiStateForTests(): void {
  highlighterPromise = null;
  unsupportedLangs.clear();
  loadingLangs.clear();
}
