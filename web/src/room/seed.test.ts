// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { clearSeed, decideSeed, peekSeed, stashSeed } from "./seed";

/**
 * These cover a data-loss bug: sharing a private document produced an empty
 * room and the text appeared to be gone.
 *
 * The cause was consuming the stashed seed before deciding whether it could be
 * applied. On a hash change the location becomes "shared" synchronously while
 * the session is still the previous one, so the check ran against the private
 * document's text, failed its "document is empty" guard, and discarded a seed
 * it had already deleted.
 */

describe("seed storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a document, Persian text included", () => {
    const text = "# سند خصوصی\n\nمتن مهمی که نباید از دست برود. می‌روم 😀";
    stashSeed("V1StGXR8_Z", text);
    expect(peekSeed("V1StGXR8_Z")).toBe(text);
  });

  it("keeps seeds for different rooms apart", () => {
    stashSeed("roomaaaaaa", "alpha");
    stashSeed("roombbbbbb", "beta");
    expect(peekSeed("roomaaaaaa")).toBe("alpha");
    expect(peekSeed("roombbbbbb")).toBe("beta");
  });

  it("peeking does not consume", () => {
    stashSeed("roomaaaaaa", "alpha");
    peekSeed("roomaaaaaa");
    peekSeed("roomaaaaaa");
    expect(peekSeed("roomaaaaaa")).toBe("alpha");
  });

  it("reports null for a room with no seed", () => {
    expect(peekSeed("roomaaaaaa")).toBeNull();
  });

  it("clears only the room asked for", () => {
    stashSeed("roomaaaaaa", "alpha");
    stashSeed("roombbbbbb", "beta");
    clearSeed("roomaaaaaa");
    expect(peekSeed("roomaaaaaa")).toBeNull();
    expect(peekSeed("roombbbbbb")).toBe("beta");
  });
});

describe("decideSeed", () => {
  /**
   * The regression. A session that is not ready yet must produce "wait", never
   * a consuming outcome: "discard" here is what destroyed the document.
   */
  it("waits, rather than discarding, while the session has no baseline", () => {
    expect(decideSeed({ seed: "important text", ready: false, documentIsEmpty: true })).toBe(
      "wait",
    );
    // The precise shape of the original bug: the location already says shared,
    // but the session still holds the private document, so it is neither ready
    // nor empty. The seed must survive this.
    expect(decideSeed({ seed: "important text", ready: false, documentIsEmpty: false })).toBe(
      "wait",
    );
  });

  it("applies a seed to a ready, empty document", () => {
    expect(decideSeed({ seed: "important text", ready: true, documentIsEmpty: true })).toBe(
      "apply",
    );
  });

  it("does not overwrite a room that already has content", () => {
    expect(decideSeed({ seed: "important text", ready: true, documentIsEmpty: false })).toBe(
      "discard",
    );
  });

  it("discards an empty seed", () => {
    expect(decideSeed({ seed: "", ready: true, documentIsEmpty: true })).toBe("discard");
  });

  it("reports nothing to do when no seed was stashed", () => {
    for (const ready of [true, false]) {
      for (const documentIsEmpty of [true, false]) {
        expect(decideSeed({ seed: null, ready, documentIsEmpty })).toBe("none");
      }
    }
  });

  it("never consumes a non-empty seed unless the session is ready", () => {
    // Exhaustive over the inputs that matter: while not ready, the only
    // acceptable answer is "wait".
    for (const documentIsEmpty of [true, false]) {
      const decision = decideSeed({ seed: "text", ready: false, documentIsEmpty });
      expect(decision, `documentIsEmpty=${documentIsEmpty}`).toBe("wait");
    }
  });
});
