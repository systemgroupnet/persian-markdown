// "Save as .md" (PLAN.md §6). Filename is derived from the document's
// first H1 (see filename.ts); the actual save mechanics (File System
// Access API with an `<a download>` fallback, cancelled-picker handling)
// live in saveFile.ts and are shared with the HTML export path.
import { deriveFilename } from "./filename";
import { saveTextFile, type SaveFileResult, type SaveTextFileOptions } from "./saveFile";

export type SaveMarkdownResult = SaveFileResult;

export interface SaveMarkdownOptions extends SaveTextFileOptions {
  /** Filename stem (no extension) used when the document has no H1. */
  fallbackName?: string;
}

/**
 * Saves `markdown` as a `.md` file. Returns `{status:"cancelled"}` (not an
 * error) when the user dismisses the native save picker.
 */
export async function saveMarkdown(
  markdown: string,
  options: SaveMarkdownOptions = {},
): Promise<SaveMarkdownResult> {
  const { fallbackName, ...saveOptions } = options;
  const filename = deriveFilename(markdown, fallbackName ?? "untitled");

  return saveTextFile(markdown, filename, "text/markdown;charset=utf-8", {
    ...saveOptions,
    pickerTypeDescription: saveOptions.pickerTypeDescription ?? "Markdown",
    pickerAccept: saveOptions.pickerAccept ?? { "text/markdown": [".md"] },
  });
}

export { deriveFilename, deriveFilenameStem, extractFirstH1, slugify } from "./filename";
