// Theme preference — light/dark, mirroring the i18n module's shape: a tiny
// typed hook that owns localStorage and one `document.documentElement`
// attribute, with no library behind it.
//
// The palette itself lives entirely in styles/theme.css; nothing here knows a
// single color. CodeMirror, shiki and mermaid all read the same CSS custom
// properties, so flipping the attribute retints every surface at once with no
// re-render and no per-library theme registry to keep in step.
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * `null` means "no explicit choice" — the OS decides, and keeps deciding if
 * the user changes it mid-session. This is the initial state, and it is why
 * the toggle is a single button rather than a three-way control: the system
 * option is the default nobody has to find, and picking either theme opts out
 * of it for good. Removing the attribute (not writing "system" into it) is
 * what hands control back to the `prefers-color-scheme` block in theme.css.
 */
export type ThemePreference = Theme | null;

const STORAGE_KEY = "pmd:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari and locked-down enterprise profiles throw on
    // localStorage access. Falling back to the OS preference is a fine
    // outcome; crashing the whole editor over a theme is not.
    return null;
  }
  return stored === "light" || stored === "dark" ? stored : null;
}

export function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference ?? systemTheme();
}

/**
 * Kept exported so index.html's pre-paint inline script and this module can
 * never disagree about what the attribute is called — see the comment there.
 */
export function applyDocumentTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (preference === null) {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function useTheme(): {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [system, setSystem] = useState<Theme>(() => systemTheme());

  // Tracked even while a preference is set, so that clearing the preference
  // resolves against the *current* OS setting rather than the one that was in
  // effect when the tab opened.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyDocumentTheme(preference);
    if (typeof window === "undefined") return;
    try {
      if (preference === null) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, preference);
      }
    } catch {
      // See readStoredPreference: storage being unavailable degrades to a
      // per-tab choice, which still works for this session.
    }
  }, [preference]);

  const theme = preference ?? system;

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
  }, []);

  // Toggling flips away from what is on screen right now, which is the only
  // reading a user can make of a two-state button — including the very first
  // click, when the theme on screen came from the OS rather than from them.
  const toggleTheme = useCallback(() => {
    setPreferenceState((current) => ((current ?? systemTheme()) === "dark" ? "light" : "dark"));
  }, []);

  return { theme, preference, setPreference, toggleTheme };
}
