// Filename derivation for "Save as .md" (PLAN.md §6): pull the document's
// first H1 and slugify it, PRESERVING Persian (and any other script's)
// characters — never transliterate, never strip them. ZWNJ (U+200C) is an
// ordinary mid-word character in Persian ("می‌روم") and must survive.

const ZWNJ = "‌";

/**
 * Returns the text of the document's first level-1 heading (ATX `# …` or a
 * setext heading underlined with `===`), or null if there isn't one.
 *
 * This is intentionally not a full CommonMark parser — fenced code blocks
 * containing a line that looks like a heading are not excluded — but it is
 * exactly what a filename-derivation heuristic needs, and matches what a
 * user would call "the title" in the vast majority of real documents.
 */
export function extractFirstH1(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (line.length === 0) continue;

    // ATX: "# Heading" — exactly one leading #, not "##...".
    const atxMatch = /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line);
    if (atxMatch?.[1]) {
      return atxMatch[1].trim();
    }

    // Setext: a non-empty line followed by a line of only "=".
    const next = lines[i + 1]?.trim();
    if (next !== undefined && /^=+$/.test(next)) {
      return line;
    }
  }

  return null;
}

/**
 * Slugifies `input` for use as a filename stem. Any Unicode letter or digit
 * (Persian, Latin, digits of any script, …) and ZWNJ are kept verbatim;
 * everything else (spaces, punctuation, symbols) collapses to a single
 * hyphen, with leading/trailing hyphens trimmed.
 *
 * `"سلام دنیا"` -> `"سلام-دنیا"`, `"می‌روم به خانه"` -> `"می‌روم-به-خانه"`
 * (note the ZWNJ inside "می‌روم" is preserved, not treated as a separator).
 */
export function slugify(input: string): string {
  const trimmed = input.normalize("NFC").trim();
  if (trimmed.length === 0) return "";

  const collapsed = trimmed.replace(/[^\p{L}\p{N}\u200C]+/gu, "-");
  return collapsed.replace(/^-+|-+$/g, "");
}

/**
 * Derives a `.md`-less filename stem for the document: the slugified first
 * H1, or `fallback` (itself slugified) if there is none / it slugifies to
 * nothing (e.g. a heading made entirely of punctuation or emoji).
 */
export function deriveFilenameStem(markdown: string, fallback: string): string {
  const heading = extractFirstH1(markdown);
  const slug = heading ? slugify(heading) : "";
  if (slug.length > 0) return slug;
  const fallbackSlug = slugify(fallback);
  return fallbackSlug.length > 0 ? fallbackSlug : fallback;
}

export function deriveFilename(markdown: string, fallback: string): string {
  return `${deriveFilenameStem(markdown, fallback)}.md`;
}

export { ZWNJ };
