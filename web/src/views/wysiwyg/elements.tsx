/**
 * Custom node components.
 *
 * Only a handful of node types ship with an installed Plate package
 * (`@platejs/basic-nodes`: marks, headings, blockquote, hr). Lists, task
 * lists, links, code blocks and tables have no installed package
 * (`@platejs/list`, `@platejs/link`, `@platejs/code-block`, `@platejs/table`
 * are NOT among the packages this task was allowed to install), so those are
 * built here directly against the same `@platejs/markdown` node shapes the
 * deserializer already produces — see `plugins.ts` for the shape reference
 * (traced from the installed package's own compiled source, not
 * remembered/web docs, per the task's API-uncertainty instruction).
 *
 * List model: Plate's markdown plugin deserializes GFM lists into the
 * "indent list" shape — flat `p` (paragraph) nodes carrying
 * `listStyleType` ('disc' | 'decimal' | 'todo'), `indent` (nesting depth)
 * and, for todo items, `checked` — rather than nested `ul`/`li` elements.
 * `ParagraphElement` below is therefore the paragraph AND the list-item
 * renderer: it reads those extra properties directly off the element.
 *
 * `dir`/`href`/`contentEditable` etc. must be merged into the `attributes`
 * prop rather than passed as top-level props to `<PlateElement>` —
 * `StyledPlateElementProps` only exposes `as`/`className`/`style` as
 * top-level styling props; everything else HTML-tag-specific goes through
 * `attributes` (typed against the real intrinsic element props for `as`).
 */
import { NodeApi, PathApi } from "platejs";
import type { PlateElementProps } from "platejs/react";
import { PlateElement, useEditorRef } from "platejs/react";

import { cn } from "@/lib/utils";

/** Every block-level node gets `dir="auto"` (PLAN.md §5.4): the Unicode
 * first-strong heuristic, native, no JS, so a Persian paragraph is RTL and
 * an adjacent English one LTR in the same mixed document. */
const BLOCK_DIR = "auto" as const;

function withAttrs<T extends Record<string, unknown>>(props: PlateElementProps, extra: T) {
  return { ...props.attributes, ...extra } as typeof props.attributes & T;
}

// ---------------------------------------------------------------------------
// Paragraph / list item
// ---------------------------------------------------------------------------

interface ListLikeElement {
  type: string;
  listStyleType?: "disc" | "decimal" | "todo" | string;
  indent?: number;
  checked?: boolean;
  listStart?: number;
}

/**
 * Ordinal for an ordered ("decimal") list item: walk previous siblings at
 * the same path depth while they belong to the same contiguous run (same
 * `listStyleType` + `indent`), skipping over more-deeply-indented siblings
 * (a nested sub-list in between doesn't break the count). This is a
 * rendering-only convenience — it mirrors, informally, what
 * `@platejs/markdown`'s own `listToMdastTree` does when serializing back to
 * a real ordered-list marker, but isn't the source of truth: the source of
 * truth is always the serialized markdown. A wrong number on screen for one
 * frame in a pathological nesting case self-heals on the next
 * deserialize/serialize round trip.
 *
 * O(n) per item per render in the worst case (a very long flat list) —
 * acceptable for the document sizes this editor targets (PLAN §4.3: 256 KiB
 * documents), not revisited here for time.
 */
function computeOrdinal(
  editor: Parameters<typeof NodeApi.get>[0],
  path: number[],
  element: ListLikeElement,
): number {
  let n = element.listStart ?? 1;
  let p: number[] | undefined = path;
  for (;;) {
    p = PathApi.previous(p);
    if (!p) break;
    const sibling = NodeApi.get(editor, p) as unknown as ListLikeElement | undefined;
    if (!sibling || sibling.type !== element.type) break;
    if ((sibling.indent ?? 0) > (element.indent ?? 0)) continue; // nested sub-list, skip over
    if (sibling.listStyleType !== element.listStyleType || (sibling.indent ?? 0) !== (element.indent ?? 0)) {
      break;
    }
    n++;
  }
  return n;
}

export function ParagraphElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = props.element as unknown as ListLikeElement;
  const { listStyleType, indent, checked } = element;

  if (!listStyleType) {
    return (
      <PlateElement {...props} as="p" attributes={withAttrs(props, { dir: BLOCK_DIR })} className="my-1 min-h-[1.5em] leading-7">
        {props.children}
      </PlateElement>
    );
  }

  const depth = Math.max(1, indent ?? 1);
  const isTodo = listStyleType === "todo";
  const marker = isTodo ? null : listStyleType === "decimal" ? `${computeOrdinal(editor, props.path, element)}.` : "•";

  return (
    <PlateElement
      {...props}
      as="p"
      attributes={withAttrs(props, { dir: BLOCK_DIR })}
      style={{ paddingInlineStart: `${(depth - 1) * 1.5}rem` }}
      className="my-0.5 flex items-start gap-2 leading-7"
    >
      <span contentEditable={false} className="mt-1 flex w-4 shrink-0 select-none items-center justify-center text-sm text-muted-foreground">
        {isTodo ? (
          <input
            type="checkbox"
            checked={checked ?? false}
            onChange={() => {
              editor.tf.setNodes({ checked: !checked } as Partial<ListLikeElement>, { at: props.path });
            }}
            className="size-3.5 cursor-pointer accent-foreground"
          />
        ) : (
          marker
        )}
      </span>
      <span className={cn("flex-1", isTodo && checked && "text-muted-foreground line-through")}>{props.children}</span>
    </PlateElement>
  );
}

// ---------------------------------------------------------------------------
// Headings (one component, parametrised by element.type — h1..h6)
// ---------------------------------------------------------------------------

const HEADING_CLASS: Record<string, string> = {
  h1: "mt-5 mb-2 text-2xl font-bold",
  h2: "mt-4 mb-2 text-xl font-bold",
  h3: "mt-3 mb-1 text-lg font-semibold",
  h4: "mt-3 mb-1 text-base font-semibold",
  h5: "mt-2 mb-1 text-base font-medium",
  h6: "mt-2 mb-1 text-sm font-medium text-muted-foreground",
};

export function HeadingElement(props: PlateElementProps) {
  const tag = props.element.type as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <PlateElement {...props} as={tag} attributes={withAttrs(props, { dir: BLOCK_DIR })} className={HEADING_CLASS[tag]}>
      {props.children}
    </PlateElement>
  );
}

// ---------------------------------------------------------------------------
// Blockquote / horizontal rule
// ---------------------------------------------------------------------------

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="blockquote"
      attributes={withAttrs(props, { dir: BLOCK_DIR })}
      className="my-2 border-s-2 border-border ps-3 text-muted-foreground"
    >
      {props.children}
    </PlateElement>
  );
}

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="hr"
      attributes={withAttrs(props, { dir: BLOCK_DIR, contentEditable: false })}
      className="my-4 border-t border-border"
    >
      {props.children}
    </PlateElement>
  );
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

export function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="pre"
      attributes={withAttrs(props, { dir: BLOCK_DIR })}
      className="my-2 overflow-x-auto rounded-[var(--radius)] border border-border bg-muted p-3 font-mono text-sm"
    >
      {props.children}
    </PlateElement>
  );
}

export function CodeLineElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div" className="whitespace-pre">
      {props.children}
    </PlateElement>
  );
}

// ---------------------------------------------------------------------------
// Link (inline)
// ---------------------------------------------------------------------------

export function LinkElement(props: PlateElementProps) {
  const url = (props.element as unknown as { url?: string }).url ?? "";
  return (
    <PlateElement
      {...props}
      as="a"
      attributes={withAttrs(props, { href: url })}
      className="underline decoration-dotted underline-offset-2"
    >
      {props.children}
    </PlateElement>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function TableElement(props: PlateElementProps) {
  return (
    <div className="my-2 overflow-x-auto">
      <PlateElement
        {...props}
        as="table"
        attributes={withAttrs(props, { dir: BLOCK_DIR })}
        className="w-full border-collapse text-sm"
      >
        <tbody>{props.children}</tbody>
      </PlateElement>
    </div>
  );
}

export function TrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="tr" className="border-b border-border">
      {props.children}
    </PlateElement>
  );
}

export function TdElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="td"
      attributes={withAttrs(props, { dir: BLOCK_DIR })}
      className="border border-border px-2 py-1 align-top"
    >
      {props.children}
    </PlateElement>
  );
}

export function ThElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      attributes={withAttrs(props, { dir: BLOCK_DIR })}
      className="border border-border bg-muted px-2 py-1 text-start font-medium"
    >
      {props.children}
    </PlateElement>
  );
}
