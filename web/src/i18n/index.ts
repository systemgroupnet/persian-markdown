// Tiny, typed i18n — deliberately no library. Persian is the default
// locale. `useI18n()` exposes `t()` (a type-checked dot-path lookup into the
// active dictionary) and `setLocale`, which flips `document.documentElement`
// `dir`/`lang` as a side effect so the whole app shell follows the toggle.
import { useCallback, useEffect, useState } from "react";
import { fa } from "./fa";
import { en } from "./en";

// The canonical shape both dictionaries must satisfy. Defined here (not
// derived from fa.ts) so fa.ts/en.ts can both `satisfies Dictionary` without
// a runtime circular dependency — only a type-only import crosses back.
export interface Dictionary {
  appName: string;
  viewMode: {
    groupLabel: string;
    source: string;
    split: string;
    wysiwyg: string;
  };
  actions: {
    saveMarkdown: string;
    exportHtml: string;
    share: string;
    about: string;
  };
  badge: {
    local: string;
    localDescription: string;
  };
  normalization: {
    title: string;
    body: string;
    normalize: string;
    stayInSource: string;
  };
  share: {
    title: string;
    fromPrivateBody: string;
    create: string;
    creating: string;
    linkLabel: string;
    copy: string;
    copied: string;
    copyFailed: string;
    accessWarning: string;
    backToPrivate: string;
  };
  connection: {
    connecting: string;
    connected: string;
    disconnected: string;
    reconnecting: string;
  };
  locale: {
    toggle: string;
    fa: string;
    en: string;
  };
}

export type Locale = "fa" | "en";

export const locales: Record<Locale, Dictionary> = { fa, en };

export const defaultLocale: Locale = "fa";

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["fa"]);

function directionFor(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

// Recursively enumerates every dot-path in T that resolves to a string leaf,
// e.g. "viewMode.source". This is what gives t() compile-time-checked keys
// without any codegen or library.
type DotPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
    }[keyof T & string];

export type TranslationKey = DotPaths<Dictionary>;

function resolve(dict: Dictionary, path: string): string {
  const value: unknown = path.split(".").reduce<unknown>((node, segment) => {
    if (node && typeof node === "object" && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dict);
  if (typeof value !== "string") {
    throw new Error(`i18n: missing key "${path}"`);
  }
  return value;
}

const STORAGE_KEY = "pmd:locale";

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "fa" || stored === "en" ? stored : defaultLocale;
}

function applyDocumentDirection(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.dir = directionFor(locale);
  document.documentElement.lang = locale;
}

export function useI18n(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
} {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    applyDocumentDirection(locale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => resolve(locales[locale], key),
    [locale],
  );

  return { locale, setLocale, t };
}

// Presentation-only helper: converts ASCII digits to Persian digits for UI
// counters/timestamps. NEVER apply this to document content — markdown text
// must keep whatever digits the user typed.
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)] ?? digit);
}
