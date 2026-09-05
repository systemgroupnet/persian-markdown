/**
 * Split view (PLAN.md §5.2, task item 7): editor pane + rendered Preview,
 * side by side, with synced scrolling and a draggable splitter.
 *
 * This component never imports the source view — it only knows the editor
 * pane as `children`, a plain `ReactNode` it hosts inside its own scrollable
 * grid cell. That keeps it usable with whatever the source-view agent ships
 * (CodeMirror today, anything else later) with zero coupling.
 *
 * ## Scroll sync
 *
 * Percentage-based (`scrollTop / (scrollHeight - clientHeight)`), rAF-
 * throttled, and — the important part — suppressed on whichever pane the
 * user is *not* currently hovering/focusing (`activePane`, tracked in a
 * ref). Without that, a program­matic scroll on the passive pane fires its
 * own `scroll` event, which would otherwise get read back as new user
 * intent and bounce back to the active pane, feeding the two panes into an
 * infinite loop. Only the active pane's scroll events are ever forwarded.
 *
 * The Preview side of the sync uses its own `PreviewProps.scrollFraction`/
 * `onScrollFractionChange` contract directly. The editor side can't: an
 * arbitrary child `ReactNode` exposes no such contract, so this reads the
 * *actual* scrolled element generically — `onScrollCapture` sees scroll
 * events from any descendant (scroll events don't bubble, but the capture
 * phase still reaches them), and `event.target` is that real scrolling
 * element, whatever it is. Applying a fraction back the other way uses the
 * same idea: the first descendant whose content overflows.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
} from "react";

import { Preview } from "../../markdown/pipeline";
import { previewStrings } from "../../markdown/strings";
import type { Locale } from "../types";

import "./SplitView.css";

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const DEFAULT_RATIO = 0.5;
const KEYBOARD_STEP = 0.02;

type ActivePane = "editor" | "preview" | null;

export interface SplitViewProps {
  /** The full markdown source, rendered read-only in the preview pane. */
  markdown: string;
  locale: Locale;
  /** The editor pane (owned by whichever agent builds the source view). */
  children: ReactNode;
  className?: string;
  /** Initial editor-pane width as a 0..1 fraction. Defaults to 0.5. */
  defaultRatio?: number;
}

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

function isRtlElement(element: Element): boolean {
  return getComputedStyle(element).direction === "rtl";
}

/** First descendant (depth-first, self included) whose content overflows. */
function findScrollable(node: Element | null): HTMLElement | null {
  if (!node || !(node instanceof HTMLElement)) return null;
  if (node.scrollHeight > node.clientHeight + 1) return node;
  for (const child of Array.from(node.children)) {
    const found = findScrollable(child);
    if (found) return found;
  }
  return null;
}

function fractionOf(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): number {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
}

export function SplitView({
  markdown,
  locale,
  children,
  className,
  defaultRatio = DEFAULT_RATIO,
}: SplitViewProps) {
  const strings = previewStrings[locale];
  const dir = locale === "fa" ? "rtl" : "ltr";

  const [ratio, setRatio] = useState(() => clampRatio(defaultRatio));
  const [previewScrollFraction, setPreviewScrollFraction] = useState<number | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const activePaneRef = useRef<ActivePane>(null);
  const editorRafRef = useRef<number | null>(null);
  const previewRafRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (editorRafRef.current !== null) cancelAnimationFrame(editorRafRef.current);
      if (previewRafRef.current !== null) cancelAnimationFrame(previewRafRef.current);
    },
    [],
  );

  // ---- Editor pane -> preview -------------------------------------------
  const handleEditorScrollCapture = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    if (activePaneRef.current !== "editor") return;
    const target = event.target as HTMLElement;
    if (editorRafRef.current !== null) return;
    editorRafRef.current = requestAnimationFrame(() => {
      editorRafRef.current = null;
      setPreviewScrollFraction(fractionOf(target));
    });
  }, []);

  // ---- Preview -> editor pane --------------------------------------------
  const handlePreviewScrollFractionChange = useCallback((fraction: number) => {
    if (activePaneRef.current !== "preview") return;
    if (previewRafRef.current !== null) return;
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = null;
      const scrollable = findScrollable(editorPaneRef.current);
      if (!scrollable) return;
      const max = scrollable.scrollHeight - scrollable.clientHeight;
      if (max <= 0) return;
      scrollable.scrollTop = fraction * max;
    });
  }, []);

  const setActive = useCallback((pane: ActivePane) => {
    activePaneRef.current = pane;
  }, []);

  // ---- Splitter drag ------------------------------------------------------
  const draggingRef = useRef(false);

  const applyPointerRatio = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rtl = isRtlElement(container);
    const fraction = rtl ? (rect.right - clientX) / rect.width : (clientX - rect.left) / rect.width;
    setRatio(clampRatio(fraction));
  }, []);

  const handleSplitterPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyPointerRatio(event.clientX);
  }, [applyPointerRatio]);

  const handleSplitterPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    applyPointerRatio(event.clientX);
  }, [applyPointerRatio]);

  const handleSplitterPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleSplitterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const container = containerRef.current;
      const rtl = container ? isRtlElement(container) : dir === "rtl";
      let delta = 0;
      if (event.key === "ArrowLeft") delta = rtl ? KEYBOARD_STEP : -KEYBOARD_STEP;
      else if (event.key === "ArrowRight") delta = rtl ? -KEYBOARD_STEP : KEYBOARD_STEP;
      else if (event.key === "Home") {
        setRatio(MIN_RATIO);
        event.preventDefault();
        return;
      } else if (event.key === "End") {
        setRatio(MAX_RATIO);
        event.preventDefault();
        return;
      } else {
        return;
      }
      event.preventDefault();
      setRatio((current) => clampRatio(current + delta));
    },
    [dir],
  );

  const gridStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--pmd-split-a": `${ratio}fr`,
        "--pmd-split-b": `${1 - ratio}fr`,
      }) as CSSProperties,
    [ratio],
  );

  return (
    <div
      ref={containerRef}
      className={["pmd-split", className].filter(Boolean).join(" ")}
      style={gridStyle}
      dir={dir}
    >
      <div
        ref={editorPaneRef}
        className="pmd-split__pane pmd-split__pane--editor"
        role="region"
        aria-label={strings.editorPane}
        onPointerEnter={() => setActive("editor")}
        onPointerLeave={() => setActive(null)}
        onFocusCapture={() => setActive("editor")}
        onBlurCapture={() => setActive(null)}
        onScrollCapture={handleEditorScrollCapture}
      >
        {children}
      </div>

      <button
        type="button"
        className="pmd-split__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label={strings.resizeHandle}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        onPointerDown={handleSplitterPointerDown}
        onPointerMove={handleSplitterPointerMove}
        onPointerUp={handleSplitterPointerUp}
        onKeyDown={handleSplitterKeyDown}
      />

      <div
        className="pmd-split__pane pmd-split__pane--preview"
        role="region"
        aria-label={strings.previewPane}
        onPointerEnter={() => setActive("preview")}
        onPointerLeave={() => setActive(null)}
        onFocusCapture={() => setActive("preview")}
        onBlurCapture={() => setActive(null)}
      >
        <Preview
          markdown={markdown}
          locale={locale}
          scrollFraction={previewScrollFraction}
          onScrollFractionChange={handlePreviewScrollFractionChange}
        />
      </div>
    </div>
  );
}
