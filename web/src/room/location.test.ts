import { describe, expect, it } from "vitest";

import { isValidRoomId, mintRoomId, readLocation, shareUrl } from "./location";

describe("room ids", () => {
  it("mints ids the server will accept", () => {
    // The pattern here must agree with internal/room/registry.go; a mismatch
    // would produce links that fail to open with no clue why.
    for (let i = 0; i < 200; i++) {
      const id = mintRoomId();
      expect(id).toHaveLength(10);
      expect(isValidRoomId(id), id).toBe(true);
    }
  });

  it("mints distinct ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintRoomId());
    expect(seen.size).toBe(1000);
  });

  it("accepts well-formed ids and rejects the rest", () => {
    for (const good of ["abc123", "V1StGXR8_Z", "a-b_c-d", "x".repeat(24)]) {
      expect(isValidRoomId(good), good).toBe(true);
    }
    for (const bad of ["", "short", "has space", "../etc/passwd", "اتاق", "x".repeat(25), "a/b"]) {
      expect(isValidRoomId(bad), bad).toBe(false);
    }
  });
});

describe("readLocation", () => {
  it("treats an empty hash as the private document", () => {
    expect(readLocation("")).toEqual({ kind: "private" });
    expect(readLocation("#")).toEqual({ kind: "private" });
  });

  it("reads a shared room", () => {
    expect(readLocation("#V1StGXR8_Z")).toEqual({ kind: "shared", id: "V1StGXR8_Z" });
    expect(readLocation("V1StGXR8_Z")).toEqual({ kind: "shared", id: "V1StGXR8_Z" });
  });

  it("falls back to private for anything malformed", () => {
    // A mistyped link should land somewhere usable rather than on a dead end.
    for (const hash of ["#short", "#has space", "#اتاق", "#%E0%A4%A", "#" + "x".repeat(40)]) {
      expect(readLocation(hash), hash).toEqual({ kind: "private" });
    }
  });

  it("decodes percent-escaped ids", () => {
    expect(readLocation("#V1StGXR8%5FZ")).toEqual({ kind: "shared", id: "V1StGXR8_Z" });
  });
});

describe("shareUrl", () => {
  it("builds a link from an explicit origin", () => {
    expect(shareUrl("V1StGXR8_Z", "https://example.test/")).toBe(
      "https://example.test/#V1StGXR8_Z",
    );
  });
});
