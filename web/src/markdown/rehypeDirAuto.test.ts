import { describe, expect, it } from "vitest";
import type { AstNode } from "./ast";
import { rehypeDirAuto } from "./rehypeDirAuto";

function el(tagName: string, properties: Record<string, unknown> = {}, children: AstNode[] = []): AstNode {
  return { type: "element", tagName, properties, children };
}

describe("rehypeDirAuto", () => {
  const plugin = rehypeDirAuto();

  it.each(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "td", "th", "dd"])(
    "sets dir=auto on <%s>",
    (tag) => {
      const tree = el("root", {}, [el(tag)]);
      plugin(tree);
      expect(tree.children?.[0]?.properties?.dir).toBe("auto");
    },
  );

  it("forces dir=ltr on <code>", () => {
    const tree = el("p", {}, [el("code")]);
    plugin(tree);
    expect(tree.children?.[0]?.properties?.dir).toBe("ltr");
    // the wrapping <p> still gets dir=auto
    expect(tree.properties?.dir).toBe("auto");
  });

  it("forces dir=ltr on <pre>", () => {
    const tree = el("pre", {}, [el("code")]);
    plugin(tree);
    expect(tree.properties?.dir).toBe("ltr");
    expect(tree.children?.[0]?.properties?.dir).toBe("ltr");
  });

  it("does not touch unrelated tags", () => {
    const tree = el("span");
    plugin(tree);
    expect(tree.properties?.dir).toBeUndefined();
  });

  it("logicalizes GFM table-cell text-align (left/right -> start/end)", () => {
    const left = el("td", { style: "text-align:left" });
    const right = el("th", { style: "text-align:right" });
    const center = el("td", { style: "text-align:center" });
    const tree = el("tr", {}, [left, right, center]);
    plugin(tree);
    expect(left.properties?.style).toBe("text-align:start");
    expect(right.properties?.style).toBe("text-align:end");
    expect(center.properties?.style).toBe("text-align:center");
    // and dir=auto still applied
    expect(left.properties?.dir).toBe("auto");
  });

  it("gives <table> itself dir=auto for correct RTL column order", () => {
    const tree = el("table");
    plugin(tree);
    expect(tree.properties?.dir).toBe("auto");
  });
});
