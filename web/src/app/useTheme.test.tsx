// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTheme, type Theme, type ThemePreference } from "./useTheme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (event: MediaQueryListEvent) => void;

/**
 * jsdom here hands back an empty object for `window.localStorage`, not a real
 * Storage — the hook survives that (every access is wrapped), but a test about
 * persistence needs somewhere for values to actually land.
 */
function installStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    },
  });
}

// jsdom implements matchMedia as always-false with no way to change the
// answer, so the OS preference is stubbed here — the whole point of the hook
// is what it does when the OS says "dark" and the user says otherwise.
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<Listener>();
  let matches = prefersDark;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? matches : false,
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

let container: HTMLElement | null = null;
let root: Root | null = null;
let latest: ReturnType<typeof useTheme> | null = null;

function Probe() {
  latest = useTheme();
  return null;
}

function render(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Probe />);
  });
}

beforeEach(() => {
  installStorage();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  latest = null;
});

describe("useTheme", () => {
  it("follows the OS preference and sets no attribute until the user chooses", () => {
    stubMatchMedia(true);
    render();

    expect(latest!.theme).toBe<Theme>("dark");
    expect(latest!.preference).toBe<ThemePreference>(null);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("toggles away from the OS theme on the first click and forces the attribute", () => {
    stubMatchMedia(true);
    render();

    act(() => latest!.toggleTheme());

    expect(latest!.theme).toBe<Theme>("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("pmd:theme")).toBe("light");
  });

  it("restores a stored preference over the OS preference", () => {
    window.localStorage.setItem("pmd:theme", "light");
    stubMatchMedia(true);
    render();

    expect(latest!.theme).toBe<Theme>("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("keeps tracking the OS while no preference is set", () => {
    const media = stubMatchMedia(false);
    render();
    expect(latest!.theme).toBe<Theme>("light");

    act(() => media.set(true));

    expect(latest!.theme).toBe<Theme>("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("hands control back to the OS when the preference is cleared", () => {
    window.localStorage.setItem("pmd:theme", "light");
    stubMatchMedia(true);
    render();

    act(() => latest!.setPreference(null));

    expect(latest!.theme).toBe<Theme>("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("pmd:theme")).toBe(null);
  });
});
