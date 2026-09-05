// Optional font embedding for HTML export (PLAN.md §5.6, §6). Fetches the
// variable Vazirmatn woff2 that `web/public/assets/fonts/` already ships
// and returns it as a base64 `data:` URL so the exported file renders in
// Vazirmatn with zero network requests. Defaults to on (~+95 KB); on any
// failure (offline dev server, moved/renamed asset, CSP, …) this degrades
// gracefully — callers get `{ ok: false }` and standaloneHtml.ts falls back
// to a system-font stack rather than throwing.
//
// The default asset path contains literal square brackets
// ("Vazirmatn[wght].woff2"), which are not valid unencoded in a URL path
// per the URL/fetch spec even though some servers tolerate them — encodeURI
// percent-encodes them (and only them, of the characters used here) before
// the request is made.
const DEFAULT_FONT_PATH = "/assets/fonts/Vazirmatn[wght].woff2";

export interface EmbedFontOptions {
  /** Path (or full URL) to the variable Vazirmatn woff2. */
  fontPath?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export type EmbedFontResult =
  | { ok: true; dataUrl: string }
  | { ok: false };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoid blowing the call stack on String.fromCharCode(...bytes)
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === "function") return btoa(binary);
  // Fallback for environments without a global btoa (rare; kept for safety).
  return Buffer.from(binary, "binary").toString("base64");
}

/**
 * Fetches the Vazirmatn variable woff2 and returns it as a `data:` URL.
 * Never throws — any failure (network, non-2xx, decoding) resolves to
 * `{ ok: false }` so callers can fall back to a system-font stack.
 */
export async function embedVazirmatnFont(
  options: EmbedFontOptions = {},
): Promise<EmbedFontResult> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) return { ok: false };

  const url = encodeURI(options.fontPath ?? DEFAULT_FONT_PATH);

  try {
    const response = await fetchImpl(url);
    if (!response.ok) return { ok: false };
    const buffer = await response.arrayBuffer();
    const base64 = bytesToBase64(new Uint8Array(buffer));
    return { ok: true, dataUrl: `data:font/woff2;base64,${base64}` };
  } catch {
    return { ok: false };
  }
}
