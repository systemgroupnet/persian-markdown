// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { saveMarkdown } from "./saveMarkdown";

describe("saveMarkdown", () => {
  it("derives the suggested filename from the document's first H1 and saves via the picker", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async (opts: { suggestedName?: string }) => ({
      name: opts.suggestedName,
      createWritable,
    }));
    const win = {
      showSaveFilePicker,
      document: { createElement: vi.fn(), body: { appendChild: vi.fn() } },
      URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
    };

    const result = await saveMarkdown("# سلام دنیا\n\nمتن.", {
      targetWindow: win as unknown as Window & typeof globalThis,
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "سلام-دنیا.md" }),
    );
    expect(result).toEqual({ status: "saved", filename: "سلام-دنیا.md", method: "picker" });
    expect(write).toHaveBeenCalledWith("# سلام دنیا\n\nمتن.");
  });

  it("handles the user cancelling the save picker without treating it as an error", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    const win = {
      showSaveFilePicker,
      document: { createElement: vi.fn(), body: { appendChild: vi.fn() } },
      URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
    };

    const result = await saveMarkdown("no heading here", {
      targetWindow: win as unknown as Window & typeof globalThis,
    });

    expect(result).toEqual({ status: "cancelled" });
  });

  it("falls back to the provided default name when there is no H1", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async (opts: { suggestedName?: string }) => ({
      name: opts.suggestedName,
      createWritable,
    }));
    const win = {
      showSaveFilePicker,
      document: { createElement: vi.fn(), body: { appendChild: vi.fn() } },
      URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
    };

    const result = await saveMarkdown("just a paragraph", {
      fallbackName: "بدون-عنوان",
      targetWindow: win as unknown as Window & typeof globalThis,
    });

    expect(result).toEqual({ status: "saved", filename: "بدون-عنوان.md", method: "picker" });
  });
});
