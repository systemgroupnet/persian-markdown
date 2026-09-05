import { describe, expect, it } from "vitest";

import { checkRoundTrip } from "./normalization";

describe("checkRoundTrip", () => {
  it("is stable when serialize(deserialize(x)) === x", () => {
    const result = checkRoundTrip(
      "unchanged",
      (md) => md,
      (value) => value,
    );
    expect(result).toEqual({ stable: true, after: "unchanged" });
  });

  it("fires — and only fires — when the round trip actually differs", () => {
    const result = checkRoundTrip(
      "_em_",
      (md) => md.replace(/_/g, "*"),
      (value) => value,
    );
    expect(result.stable).toBe(false);
    expect(result.after).toBe("*em*");
  });

  it("does not fire for a deserialize/serialize pair that happens to be lossy but round-trips to the same text", () => {
    // Some transforms lose information but still produce byte-identical
    // output for this particular input — stable must key off the final
    // string equality, not "did anything change internally".
    const result = checkRoundTrip(
      "same",
      () => ({ discardedMetadata: true }),
      () => "same",
    );
    expect(result.stable).toBe(true);
  });
});
