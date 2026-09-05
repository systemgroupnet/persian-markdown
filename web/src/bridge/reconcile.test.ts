import { describe, expect, it } from "vitest";

import { diffBlocks, nodesEqual } from "./reconcile";

function p(text: string, extra: Record<string, unknown> = {}) {
  return { type: "p", ...extra, children: [{ text }] };
}

describe("nodesEqual", () => {
  it("is true for structurally identical trees regardless of key order", () => {
    const a = { type: "p", indent: 1, children: [{ text: "x" }] };
    const b = { indent: 1, children: [{ text: "x" }], type: "p" };
    expect(nodesEqual(a, b)).toBe(true);
  });

  it("is false when text differs", () => {
    expect(nodesEqual(p("a"), p("b"))).toBe(false);
  });

  it("is false when a property is present vs. absent", () => {
    expect(nodesEqual(p("a"), p("a", { checked: false }))).toBe(false);
  });

  it("is true for equal arrays and false for different lengths", () => {
    expect(nodesEqual([p("a"), p("b")], [p("a"), p("b")])).toBe(true);
    expect(nodesEqual([p("a")], [p("a"), p("b")])).toBe(false);
  });
});

describe("diffBlocks", () => {
  it("reports no-op for identical documents", () => {
    const value = [p("hello"), p("world")];
    const result = diffBlocks(value, [p("hello"), p("world")]);
    expect(result).toEqual({ sameLength: true, changedIndices: [], isNoop: true });
  });

  it("finds exactly the changed index for a single remote edit elsewhere", () => {
    const oldValue = [p("hello"), p("world"), p("caret is here")];
    const newValue = [p("hello"), p("WORLD edited remotely"), p("caret is here")];
    const result = diffBlocks(oldValue, newValue);
    expect(result.sameLength).toBe(true);
    expect(result.changedIndices).toEqual([1]);
    expect(result.isNoop).toBe(false);
  });

  it("finds multiple changed indices", () => {
    const oldValue = [p("a"), p("b"), p("c")];
    const newValue = [p("A"), p("b"), p("C")];
    const result = diffBlocks(oldValue, newValue);
    expect(result.changedIndices).toEqual([0, 2]);
  });

  it("flags a structural edit (block count changed) via sameLength=false", () => {
    const oldValue = [p("a"), p("b")];
    const newValue = [p("a"), p("inserted"), p("b")];
    const result = diffBlocks(oldValue, newValue);
    expect(result.sameLength).toBe(false);
  });

  it("treats list-item property changes (indent/listStyleType/checked) as a diff", () => {
    const oldValue = [p("buy milk", { listStyleType: "todo", indent: 1, checked: false })];
    const newValue = [p("buy milk", { listStyleType: "todo", indent: 1, checked: true })];
    const result = diffBlocks(oldValue, newValue);
    expect(result.changedIndices).toEqual([0]);
  });
});
