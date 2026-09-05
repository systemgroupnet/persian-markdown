import type { Locale } from "../types";

/**
 * User-facing strings owned by this view. views/i18n/** is off-limits to
 * this agent (four view agents run in parallel against it), so SourceView
 * carries its own tiny per-locale dictionary; the integrator merges these
 * keys into the app-wide dictionary in src/i18n/{fa,en}.ts.
 *
 * Keys, for the integrator's merge:
 *   - source.editorLabel: accessible name for the source editor's
 *     contenteditable region (exposed via aria-label so screen readers
 *     announce something more useful than "text field").
 */
export const sourceStrings: Record<Locale, { source: { editorLabel: string } }> = {
  fa: {
    source: {
      editorLabel: "ویرایشگر متن مارک‌داون",
    },
  },
  en: {
    source: {
      editorLabel: "Markdown source editor",
    },
  },
};
