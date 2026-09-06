// Persian dictionary — the default locale. Keep keys in the exact same
// shape as en.ts; TypeScript enforces this via `satisfies Dictionary`.
import type { Dictionary } from "./index";

export const fa = {
  appName: "ویرایشگر مارک‌داون فارسی",

  viewMode: {
    groupLabel: "حالت نمایش",
    source: "متن",
    split: "دونیمه",
    wysiwyg: "دیداری",
  },

  actions: {
    saveMarkdown: "ذخیره به‌صورت مارک‌داون",
    exportHtml: "خروجی HTML",
    share: "اشتراک‌گذاری",
    about: "درباره",
  },

  badge: {
    local: "محلی",
    localDescription: "این سند فقط روی همین دستگاه ذخیره می‌شود و هرگز به سرور ارسال نمی‌گردد.",
  },

  normalization: {
    title: "یکدست‌سازی قالب‌بندی",
    body: "ورود به حالت ویرایش دیداری، قالب‌بندی این سند را یکدست می‌کند؛ برای نمونه _تاکید_ به *تاکید* تبدیل می‌شود. این تغییر برای همه‌ی همکاران اعمال خواهد شد.",
    normalize: "یکدست کن و ادامه بده",
    stayInSource: "در حالت متن بمان",
  },

  share: {
    title: "اشتراک‌گذاری سند",
    fromPrivateBody:
      "یک اتاق تازه ساخته می‌شود و متن فعلی در آن کپی می‌گردد. سند محلی شما دست‌نخورده باقی می‌ماند.",
    create: "ساخت پیوند اشتراکی",
    creating: "در حال ساخت…",
    linkLabel: "پیوند اتاق",
    copy: "رونوشت",
    copied: "رونوشت شد",
    copyFailed: "رونوشت ممکن نشد؛ پیوند را دستی کپی کنید.",
    accessWarning:
      "هرکس این پیوند را داشته باشد می‌تواند سند را بخواند و ویرایش کند. هیچ حساب کاربری یا رمزی در کار نیست.",
    backToPrivate: "بازگشت به سند محلی",
  },

  connection: {
    connecting: "در حال اتصال…",
    connected: "متصل",
    disconnected: "قطع شده",
    reconnecting: "در حال اتصال دوباره…",
  },

  locale: {
    toggle: "زبان",
    fa: "فارسی",
    en: "English",
  },

  theme: {
    toLight: "تغییر به پوسته‌ی روشن",
    toDark: "تغییر به پوسته‌ی تیره",
  },
} satisfies Dictionary;
