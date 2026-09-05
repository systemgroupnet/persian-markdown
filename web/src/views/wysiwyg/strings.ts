/**
 * WYSIWYG-local strings.
 *
 * NOT part of web/src/i18n/** on purpose — that directory is owned by a
 * parallel agent and several are editing at once. The integrator should fold
 * these keys into the shared dictionary later; until then this module is the
 * single source of truth for WYSIWYG copy, keyed the same way (`fa`/`en`)
 * so the merge is mechanical.
 *
 * Keys, for the integrator's merge:
 *   toolbar.bold, toolbar.italic, toolbar.strikethrough, toolbar.code,
 *   toolbar.heading1, toolbar.heading2, toolbar.heading3,
 *   toolbar.bulletList, toolbar.orderedList, toolbar.taskList,
 *   toolbar.link, toolbar.blockquote, toolbar.codeBlock, toolbar.table,
 *   toolbar.horizontalRule
 *   linkPrompt.url
 *   normalization.title, normalization.body, normalization.normalize,
 *   normalization.stayInSource
 */
export const wysiwygStrings = {
  fa: {
    toolbar: {
      bold: "درشت",
      italic: "کج",
      strikethrough: "خط‌خورده",
      code: "کد درون‌خطی",
      heading1: "عنوان ۱",
      heading2: "عنوان ۲",
      heading3: "عنوان ۳",
      bulletList: "فهرست نقطه‌ای",
      orderedList: "فهرست شماره‌دار",
      taskList: "فهرست کار",
      link: "پیوند",
      blockquote: "نقل‌قول",
      codeBlock: "بلوک کد",
      table: "جدول",
      horizontalRule: "خط افقی",
    },
    linkPrompt: {
      url: "نشانی پیوند را وارد کنید:",
    },
    normalization: {
      title: "یکدست‌سازی قالب‌بندی",
      body: "ورود به حالت ویرایش دیداری قالب‌بندی سند را یکدست می‌کند (برای نمونه تأکیدهای _این‌چنینی_ به *این شکل* تبدیل می‌شوند). این تغییر تا تأیید شما اعمال نخواهد شد.",
      normalize: "یکدست‌سازی و ادامه",
      stayInSource: "ماندن در حالت متنی",
    },
  },
  en: {
    toolbar: {
      bold: "Bold",
      italic: "Italic",
      strikethrough: "Strikethrough",
      code: "Inline code",
      heading1: "Heading 1",
      heading2: "Heading 2",
      heading3: "Heading 3",
      bulletList: "Bulleted list",
      orderedList: "Numbered list",
      taskList: "Task list",
      link: "Link",
      blockquote: "Blockquote",
      codeBlock: "Code block",
      table: "Table",
      horizontalRule: "Horizontal rule",
    },
    linkPrompt: {
      url: "Enter a URL:",
    },
    normalization: {
      title: "Formatting will be normalised",
      body: "Entering visual editing mode normalises the document's markdown formatting (e.g. _emphasis like this_ becomes *this*). Nothing changes until you confirm.",
      normalize: "Normalise and continue",
      stayInSource: "Stay in source mode",
    },
  },
} as const;

export type WysiwygLocale = keyof typeof wysiwygStrings;
export type WysiwygStrings = (typeof wysiwygStrings)[WysiwygLocale];
