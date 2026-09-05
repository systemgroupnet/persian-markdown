/**
 * `usePlateEditor`'s generic inference doesn't reliably pick up
 * `MarkdownPlugin`'s added `editor.api.markdown` surface from a plain plugin
 * array (`wysiwygPlugins` mixes plugins built several different ways —
 * `toPlatePlugin`-derived, `createPlatePlugin`-derived, `.withComponent`
 * variants — and TS's inference over that union doesn't merge back into a
 * single `api` shape the way `createSlateEditor` with the same array
 * happens to). Asserting the augmented type once, here, is simpler and more
 * honest than fighting the generics: the shape below is exactly what
 * `@platejs/markdown`'s own `MarkdownConfig` declares it adds
 * (node_modules/@platejs/markdown/dist/index.d.ts).
 */
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";

export interface MarkdownEditor extends PlateEditor {
  api: PlateEditor["api"] & {
    markdown: {
      serialize: (options?: { value?: Value }) => string;
      deserialize: (data: string, options?: unknown) => Value;
    };
  };
}

export function asMarkdownEditor(editor: PlateEditor): MarkdownEditor {
  return editor as MarkdownEditor;
}
