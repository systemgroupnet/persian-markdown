/**
 * UI strings owned by this module (markdown preview + split view).
 *
 * PROHIBITION: web/src/i18n/** is owned by a parallel agent and must not be
 * touched here. This module is intentionally self-contained — the
 * integrator merges these keys into the shared dictionary; see the task
 * report for the exact list.
 */

export interface PreviewStrings {
  /** Announced while a mermaid diagram is being parsed/rendered. */
  mermaidLoading: string;
  /** Shown when a ```mermaid fence fails to parse/render. */
  mermaidError: string;
  /** Shown in the preview pane when the document has no content yet. */
  empty: string;
  /** aria-label for the editor pane landmark in split view. */
  editorPane: string;
  /** aria-label for the preview pane landmark in split view. */
  previewPane: string;
  /** aria-label for the draggable splitter in split view. */
  resizeHandle: string;
}

export const previewStrings: Record<"fa" | "en", PreviewStrings> = {
  fa: {
    mermaidLoading: "در حال رسم نمودار…",
    mermaidError: "رسم نمودار با خطا مواجه شد",
    empty: "چیزی برای پیش‌نمایش وجود ندارد",
    editorPane: "ویرایشگر",
    previewPane: "پیش‌نمایش",
    resizeHandle: "تغییر اندازهٔ بخش‌ها",
  },
  en: {
    mermaidLoading: "Rendering diagram…",
    mermaidError: "Failed to render diagram",
    empty: "Nothing to preview yet",
    editorPane: "Editor",
    previewPane: "Preview",
    resizeHandle: "Resize panes",
  },
};
