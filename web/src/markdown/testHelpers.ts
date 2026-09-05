/**
 * Small mount/flush helpers shared by this package's React tests.
 *
 * @testing-library/react isn't an installed dependency (adding it would
 * mean touching package.json/the lockfile, which is prohibited — see the
 * task's PROHIBITIONS), so tests mount components directly with
 * `react-dom/client` + `react`'s `act`.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// React's act() gates on this flag in React 18+; jsdom doesn't set it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLDivElement;
  root: Root;
  update: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    update: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Flushes any pending microtasks (e.g. a resolved dynamic import) + effects. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Polls `predicate` until it's true, flushing effects between attempts.
 * Needed because a lazy load (dynamic `import()` -> setState -> re-render
 * -> another effect) can take more hops than a couple of microtask ticks
 * account for — real dynamic `import()`, even of an already-cached module,
 * schedules through the module loader rather than resolving synchronously.
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition never became true within timeout");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
