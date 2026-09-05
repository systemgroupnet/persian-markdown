// UI strings owned by the export feature. Deliberately NOT part of
// web/src/i18n/** (see PLAN.md §6 and the build brief for this module) —
// several agents touch i18n in parallel, so this module exports its own
// bilingual dictionary. An integrator merges these keys into
// web/src/i18n/{fa,en}.ts (and Dictionary in i18n/index.ts) by hand, e.g.
// under a new `export` namespace.
//
// Keys:
//   defaultFilename  — used when saveMarkdown() can't find an H1 to derive
//                       a name from.
//   embedFontLabel   — checkbox label for the "embed Vazirmatn" export option.
//   embedFontHint    — helper text under that checkbox (size cost).
//   saveCancelled    — informational message when the save picker is dismissed.
//   saveFailed       — error message when saving fails for a reason other
//                       than user cancellation.
//   exportFailed     — error message when HTML export fails.
export interface ExportDictionary {
  defaultFilename: string;
  embedFontLabel: string;
  embedFontHint: string;
  saveCancelled: string;
  saveFailed: string;
  exportFailed: string;
}

export const exportStrings: Record<"fa" | "en", ExportDictionary> = {
  fa: {
    defaultFilename: "بدون-عنوان",
    embedFontLabel: "جاسازی فونت وزیرمتن",
    embedFontHint: "برای نمایش صحیح آفلاین؛ حدود ۹۵ کیلوبایت به حجم فایل اضافه می‌کند.",
    saveCancelled: "ذخیره‌سازی لغو شد.",
    saveFailed: "ذخیره فایل با خطا مواجه شد.",
    exportFailed: "خروجی HTML با خطا مواجه شد.",
  },
  en: {
    defaultFilename: "untitled",
    embedFontLabel: "Embed Vazirmatn font",
    embedFontHint: "Adds about 95 KB so the file renders correctly offline.",
    saveCancelled: "Save cancelled.",
    saveFailed: "Saving the file failed.",
    exportFailed: "Exporting HTML failed.",
  },
};
