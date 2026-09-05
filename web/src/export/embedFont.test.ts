import { describe, expect, it, vi } from "vitest";

import { embedVazirmatnFont } from "./embedFont";

function fakeResponse(ok: boolean, bytes?: Uint8Array) {
  return {
    ok,
    arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer,
  } as Response;
}

describe("embedVazirmatnFont", () => {
  it("returns a base64 data: URL on success", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    const fetchImpl = vi.fn(async () => fakeResponse(true, bytes));

    const result = await embedVazirmatnFont({ fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataUrl.startsWith("data:font/woff2;base64,")).toBe(true);
    }
  });

  it("percent-encodes the square brackets in the default font path", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      fakeResponse(true, new Uint8Array([1])),
    );
    await embedVazirmatnFont({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe("/assets/fonts/Vazirmatn%5Bwght%5D.woff2");
  });

  it("degrades gracefully (does not throw) when the response is not ok", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(false));
    const result = await embedVazirmatnFont({ fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("degrades gracefully (does not throw) when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(embedVazirmatnFont({ fetchImpl })).resolves.toEqual({ ok: false });
  });

  it("degrades gracefully when no fetch implementation is available at all", async () => {
    const result = await embedVazirmatnFont({ fetchImpl: undefined as unknown as typeof fetch });
    // Falls through to global fetch resolution; in this environment that
    // may or may not exist — either way it must never throw.
    expect(typeof result.ok).toBe("boolean");
  });
});
