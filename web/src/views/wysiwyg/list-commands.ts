/**
 * List/task-list toggling. There is no installed `@platejs/list` package, so
 * there's no ready-made `editor.tf.list.toggle()` — this is the minimal hand
 * rolled equivalent for the "indent list" node shape `ParagraphElement`
 * renders (see plugins.ts's module doc for where that shape comes from).
 *
 * Toggling is a plain property set/unset on the current block's paragraph:
 * `listStyleType`/`indent`/`checked`/`listStart` in, or all four out via
 * `undefined` (Slate's `setNodes` convention: a property set to `undefined`
 * in `newProperties` is removed from the node, not set to the literal value
 * `undefined`).
 */
import type { PlateEditor } from "platejs/react";

export type ListStyle = "disc" | "decimal" | "todo";

interface ListProps {
  listStyleType?: ListStyle;
  indent?: number;
  checked?: boolean;
  listStart?: number;
  [key: string]: unknown;
}

export function toggleList(editor: PlateEditor, style: ListStyle): void {
  const entry = editor.api.block();
  if (!entry) return;
  const [rawNode, path] = entry;
  const node = rawNode as unknown as { type: string } & ListProps;
  if (node.type !== "p") return; // only paragraphs participate in the indent-list model

  const isSameStyle = node.listStyleType === style;
  const next: ListProps = isSameStyle
    ? { listStyleType: undefined, indent: undefined, checked: undefined, listStart: undefined }
    : {
        listStyleType: style,
        indent: node.indent ?? 1,
        checked: style === "todo" ? (node.checked ?? false) : undefined,
        listStart: undefined,
      };

  editor.tf.setNodes(next, { at: path });
}
