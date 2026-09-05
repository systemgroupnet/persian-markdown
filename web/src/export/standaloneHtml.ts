// Self-contained HTML export (PLAN.md §6). Wraps already-rendered markup
// into ONE file with no external references at all — it has to open
// correctly from a USB stick with no internet. The caller (the render
// pipeline, owned by another agent) hands us plain strings: `bodyHtml` is
// the rendered document (Mermaid already inline `<svg>`, KaTeX already
// rendered to its HTML/MathML), `css` is the preview stylesheet extracted
// to a string at build time. This module does not import or know about
// that pipeline — it only assembles strings.

export interface BuildStandaloneHtmlOptions {
  /** Already-rendered document body markup (no <script> expected in it). */
  bodyHtml: string;
  /** Preview CSS, as plain text, to inline in a single <style>. */
  css: string;
  /** Used for both the <title> and the visible document title fallback. */
  title: string;
  locale: "fa" | "en";
  /** Whether to inline the Vazirmatn @font-face (see embedFont.ts). */
  embedFont: boolean;
  /** base64 `data:` URL for the variable Vazirmatn woff2, if embedFont is on and the fetch succeeded. */
  fontDataUrl?: string;
}

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Vazirmatn", "Noto Sans Arabic", ' +
  "Tahoma, sans-serif";

/** Escapes text for placement inside an HTML text node (e.g. <title>). */
function escapeHtmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Neutralizes any `</style` or `</script` sequence inside text that is
 * going to be embedded verbatim into the document (arbitrary CSS text, or
 * defense-in-depth for the body markup). This is the only thing standing
 * between "self-contained file" and "the CSS text happens to contain the
 * literal characters `</style>` and breaks the document out of the style
 * block" — cheap insurance, not a general HTML sanitizer.
 */
function neutralizeClosingTags(input: string): string {
  return input.replace(/<\/(style|script)/gi, "<\\/$1");
}

function buildFontFaceRule(fontDataUrl: string): string {
  return (
    "@font-face{" +
    'font-family:"Vazirmatn";' +
    `src:url(${JSON.stringify(fontDataUrl)}) format("woff2-variations"),` +
    `url(${JSON.stringify(fontDataUrl)}) format("woff2");` +
    "font-weight:100 900;" +
    "font-style:normal;" +
    "font-display:swap;" +
    "}"
  );
}

/**
 * Builds one self-contained HTML document string: no external stylesheet,
 * script, font, or image reference is introduced by this function. The
 * resulting file opens and renders correctly with the network disabled.
 *
 * Note on scope: this function does not rewrite URLs that may already be
 * present *inside* `bodyHtml` (e.g. a user-authored `<img src="https://…">`
 * in the source document). Those are the document author's own remote
 * references and are outside what a wrapper function can resolve without
 * fetching arbitrary third-party content at export time.
 */
export function buildStandaloneHtml(options: BuildStandaloneHtmlOptions): string {
  const { bodyHtml, css, title, locale, embedFont, fontDataUrl } = options;

  const dir = locale === "fa" ? "rtl" : "ltr";
  const safeTitle = escapeHtmlText(title.trim().length > 0 ? title : "Untitled");
  const safeCss = neutralizeClosingTags(css);
  const safeBody = neutralizeClosingTags(bodyHtml);

  const fontRule = embedFont && fontDataUrl ? buildFontFaceRule(fontDataUrl) : "";
  const fontFamilyDeclaration = embedFont && fontDataUrl
    ? `"Vazirmatn", ${SYSTEM_FONT_STACK}`
    : SYSTEM_FONT_STACK;

  const styleBlock = [
    fontRule,
    `:root{color-scheme:light dark;}`,
    `body{margin:0;font-family:${fontFamilyDeclaration};}`,
    safeCss,
  ]
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  return (
    "<!doctype html>\n" +
    `<html lang="${locale}" dir="${dir}">\n` +
    "<head>\n" +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${safeTitle}</title>\n` +
    `<style>\n${styleBlock}\n</style>\n` +
    "</head>\n" +
    `<body dir="auto">\n${safeBody}\n</body>\n` +
    "</html>\n"
  );
}
