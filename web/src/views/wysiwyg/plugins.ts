/**
 * The Plate plugin set for the WYSIWYG view.
 *
 * Only `platejs`, `@platejs/basic-nodes` and `@platejs/markdown` are
 * installed (task constraint: no `pnpm add`). Marks, headings, blockquote
 * and hr come from `@platejs/basic-nodes/react`, which ships ready-made
 * React plugins (default DOM rendering via `render.as`, plus a
 * `.toggle()` transform per plugin). There is no installed list, link,
 * code-block or table package, so those four are hand-built here as plain
 * `createPlatePlugin` element plugins with a custom component — their
 * node shapes (`p` + listStyleType/indent/checked, `a` + url, `code_block`
 * > `code_line`, `table` > `tr` > `td`/`th` > `p`) were traced from
 * `@platejs/markdown`'s own compiled deserializer
 * (node_modules/@platejs/markdown/dist/index.js), not from remembered or
 * web-found examples, per the task's instruction to verify against the
 * installed package when the API is unclear.
 *
 * The `list` plugin below has NO node/component at all — it exists purely
 * as a feature-detection flag. `@platejs/markdown`'s deserializer branches
 * on `!!options.editor?.plugins.list`: without it, GFM lists deserialize to
 * the "classic" nested ul/li shape (and task-list `checked` state is
 * dropped); with any plugin registered under the key `"list"`, it
 * deserializes to the flat indent-list shape our `ParagraphElement` renders
 * (including `checked` for `- [ ]` / `- [x]` items). Serialization already
 * detects the indent-list shape structurally either way (see
 * `convertNodesSerialize` in the same file), so this flag only matters for
 * deserialize.
 */
import remarkGfm from "remark-gfm";

import { MarkdownPlugin } from "@platejs/markdown";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { ParagraphPlugin, createPlatePlugin } from "platejs/react";

import {
  BlockquoteElement,
  CodeBlockElement,
  CodeLineElement,
  HeadingElement,
  HrElement,
  LinkElement,
  ParagraphElement,
  TableElement,
  TdElement,
  ThElement,
  TrElement,
} from "./elements";

/** Pure feature-detection flag — see module doc. */
const ListMarkerPlugin = createPlatePlugin({ key: "list" });

const LinkPlugin = createPlatePlugin({
  key: "a",
  node: { isElement: true, isInline: true },
}).withComponent(LinkElement);

const CodeBlockPlugin = createPlatePlugin({
  key: "code_block",
  node: { isElement: true },
}).withComponent(CodeBlockElement);

const CodeLinePlugin = createPlatePlugin({
  key: "code_line",
  node: { isElement: true },
}).withComponent(CodeLineElement);

const TablePlugin = createPlatePlugin({
  key: "table",
  node: { isElement: true },
}).withComponent(TableElement);

const TableRowPlugin = createPlatePlugin({
  key: "tr",
  node: { isElement: true },
}).withComponent(TrElement);

const TableCellPlugin = createPlatePlugin({
  key: "td",
  node: { isElement: true },
}).withComponent(TdElement);

const TableHeaderCellPlugin = createPlatePlugin({
  key: "th",
  node: { isElement: true },
}).withComponent(ThElement);

export const wysiwygPlugins = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.withComponent(HeadingElement),
  H2Plugin.withComponent(HeadingElement),
  H3Plugin.withComponent(HeadingElement),
  H4Plugin.withComponent(HeadingElement),
  H5Plugin.withComponent(HeadingElement),
  H6Plugin.withComponent(HeadingElement),
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  BlockquotePlugin.withComponent(BlockquoteElement),
  HorizontalRulePlugin.withComponent(HrElement),
  ListMarkerPlugin,
  LinkPlugin,
  CodeBlockPlugin,
  CodeLinePlugin,
  TablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableHeaderCellPlugin,
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [remarkGfm],
      // remark-stringify's own defaults (emphasis "_", bullet "*", rule "*")
      // are legal CommonMark/GFM but not what most Persian/English markdown
      // in the wild looks like, which means using them would make
      // hazard-one's normalisation prompt fire on nearly every document.
      // These pick the more common convention instead, so ordinarily
      // formatted input round-trips silently and the prompt is reserved for
      // markdown that genuinely needs normalising (setext headings,
      // mismatched list markers, `_em_`, GFM table column padding, ...).
      remarkStringifyOptions: {
        bullet: "-",
        emphasis: "*",
        rule: "-",
        ruleSpaces: false,
      },
    },
  }),
];
