// Facade for the export feature (PLAN.md §6). This is the module the app
// shell imports from; it wires the pieces (font embedding, HTML assembly,
// file saving) into two calls: saveMarkdown() and exportDocumentAsHtml().
import { buildStandaloneHtml, type BuildStandaloneHtmlOptions } from "./standaloneHtml";
import { embedVazirmatnFont } from "./embedFont";
import { saveTextFile, type SaveFileResult } from "./saveFile";
import { slugify } from "./filename";

export { saveMarkdown } from "./saveMarkdown";
export type { SaveMarkdownOptions, SaveMarkdownResult } from "./saveMarkdown";
export { deriveFilename, deriveFilenameStem, extractFirstH1, slugify } from "./filename";
export { buildStandaloneHtml } from "./standaloneHtml";
export type { BuildStandaloneHtmlOptions } from "./standaloneHtml";
export { embedVazirmatnFont } from "./embedFont";
export type { EmbedFontOptions, EmbedFontResult } from "./embedFont";
export { exportStrings } from "./strings";
export type { ExportDictionary } from "./strings";

export type ExportHtmlResult = SaveFileResult & { fontEmbedded?: boolean };

export interface ExportDocumentAsHtmlOptions {
  /** Already-rendered document body markup (Mermaid/KaTeX already resolved). */
  bodyHtml: string;
  /** Preview CSS as plain text. */
  css: string;
  /** Document title — used for <title> and, slugified, the suggested filename. */
  title: string;
  locale: "fa" | "en";
  /** Whether to inline the Vazirmatn font. Defaults to true (PLAN.md §6). */
  embedFont?: boolean;
  /** Filename stem used when `title` slugifies to nothing. */
  fallbackName?: string;
  /** Overrides, mainly for tests. */
  targetWindow?: Window & typeof globalThis;
  fetchImpl?: typeof fetch;
}

/**
 * Exports the current document as ONE self-contained HTML file (PLAN.md
 * §6) and saves it via the same picker/download path as saveMarkdown().
 *
 * The caller (the render pipeline / view layer) is responsible for
 * producing `bodyHtml`/`css` with Mermaid already serialized to inline SVG
 * and KaTeX already rendered — this facade only assembles and saves the
 * resulting document; it never imports or depends on that pipeline.
 */
export async function exportDocumentAsHtml(
  options: ExportDocumentAsHtmlOptions,
): Promise<ExportHtmlResult> {
  const embedFontRequested = options.embedFont ?? true;

  let fontDataUrl: string | undefined;
  let fontEmbedded = false;
  if (embedFontRequested) {
    const fontResult = await embedVazirmatnFont({ fetchImpl: options.fetchImpl });
    if (fontResult.ok) {
      fontDataUrl = fontResult.dataUrl;
      fontEmbedded = true;
    }
  }

  const htmlOptions: BuildStandaloneHtmlOptions = {
    bodyHtml: options.bodyHtml,
    css: options.css,
    title: options.title,
    locale: options.locale,
    embedFont: embedFontRequested,
    fontDataUrl,
  };
  const html = buildStandaloneHtml(htmlOptions);

  // `title` is a plain string, not markdown source, so it's slugified
  // directly rather than scanned for an H1 (unlike saveMarkdown()).
  const fallbackSlug = slugify(options.fallbackName ?? "untitled");
  const filenameStem =
    slugify(options.title) || fallbackSlug || options.fallbackName || "untitled";
  const filename = `${filenameStem}.html`;

  const saveResult = await saveTextFile(html, filename, "text/html;charset=utf-8", {
    targetWindow: options.targetWindow,
    pickerTypeDescription: "HTML",
    pickerAccept: { "text/html": [".html"] },
  });

  return { ...saveResult, fontEmbedded };
}
