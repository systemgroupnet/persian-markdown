/**
 * Minimal structural (duck-typed) mirrors of the mdast/hast node shapes we
 * touch. We deliberately do NOT `import type ... from "mdast"/"hast"/"unified"`:
 * those packages are only *transitive* dependencies (of react-markdown,
 * remark-gfm, ...) and are not hoisted by pnpm into web/node_modules, so an
 * import here would resolve for react-markdown's own .d.ts but not for a
 * module living under web/src/markdown. remark-gfm@4/remark-math@6/
 * react-markdown@10 are the only markdown-ecosystem packages this project
 * declares directly (see package.json) — everything else in the pipeline is
 * plain functions shaped like unified plugins, passed straight into
 * react-markdown's `remarkPlugins`/`rehypePlugins`, which run them through
 * *its own* unified processor. That processor doesn't care where the plugin
 * function came from, only that it has the right call signature, so no
 * import of `unified` itself is needed on this side either.
 */

/** A generic syntax tree node — mdast or hast, before/after transforms. */
export interface AstNode {
  type: string;
  /** hast only: the tag name for `type: "element"` nodes. */
  tagName?: string;
  /** hast only: attributes destined to become DOM properties. */
  properties?: Record<string, unknown>;
  /** mdast `code` nodes: the fence's info-string language. */
  lang?: string | null;
  /** Text/code/math leaf content. */
  value?: string;
  children?: AstNode[];
}

/** Depth-first walk, pre-order, visiting every node including the root. */
export function walkAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  if (node.children) {
    for (const child of node.children) walkAst(child, visit);
  }
}
