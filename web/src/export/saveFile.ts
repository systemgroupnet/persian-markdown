// Shared "save this text as a file" primitive behind both saveMarkdown.ts
// and the HTML export path in index.ts. Prefers the File System Access API
// (`showSaveFilePicker`) so repeat saves can overwrite the same file;
// falls back to an `<a download>` blob everywhere else. A cancelled picker
// is reported as `{status:"cancelled"}`, never as an error.
//
// The File System Access API isn't in this project's TS lib target (no
// @types/wicg-file-system-access dependency — intentionally not adding
// one), so the minimal shape used here is declared locally.

interface MinimalWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface MinimalFileSystemFileHandle {
  readonly name?: string;
  createWritable(): Promise<MinimalWritableFileStream>;
}

type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: ReadonlyArray<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<MinimalFileSystemFileHandle>;

interface WindowWithSavePicker {
  showSaveFilePicker?: ShowSaveFilePicker;
}

export type SaveFileResult =
  | { status: "saved"; filename: string; method: "picker" | "download" }
  | { status: "cancelled" }
  | { status: "error"; error: unknown };

export interface SaveTextFileOptions {
  /** Override, mainly for tests; defaults to the global `window`. */
  targetWindow?: Window & typeof globalThis;
  /** Shown in the native "Save as" type dropdown, e.g. "Markdown". */
  pickerTypeDescription?: string;
  /** e.g. `{ "text/markdown": [".md"] }`. */
  pickerAccept?: Record<string, string[]>;
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function saveViaDownloadLink(
  content: string,
  filename: string,
  mimeType: string,
  win: Window & typeof globalThis,
): SaveFileResult {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = win.URL.createObjectURL(blob);
    try {
      const anchor = win.document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      win.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      win.URL.revokeObjectURL(url);
    }
    return { status: "saved", filename, method: "download" };
  } catch (error) {
    return { status: "error", error };
  }
}

export async function saveTextFile(
  content: string,
  filename: string,
  mimeType: string,
  options: SaveTextFileOptions = {},
): Promise<SaveFileResult> {
  const win = options.targetWindow ?? (typeof window !== "undefined" ? window : undefined);
  if (!win) {
    return { status: "error", error: new Error("saveTextFile: no window available") };
  }

  const showSaveFilePicker = (win as unknown as WindowWithSavePicker).showSaveFilePicker;

  if (typeof showSaveFilePicker === "function") {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: options.pickerAccept
          ? [{ description: options.pickerTypeDescription, accept: options.pickerAccept }]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { status: "saved", filename: handle.name ?? filename, method: "picker" };
    } catch (error) {
      if (isAbortError(error)) {
        return { status: "cancelled" };
      }
      return { status: "error", error };
    }
  }

  return saveViaDownloadLink(content, filename, mimeType, win);
}
