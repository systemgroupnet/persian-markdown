import { describe, expect, it } from "vitest";

import { ProtocolError, decodeServerMsg } from "./types";

/**
 * The wire contract with the Go server.
 *
 * The case that matters most here is `History.operations` arriving as `null`.
 * Go marshals a nil slice that way, so a server with nothing to replay can
 * legitimately send it. Rejecting the message meant the session never
 * established a baseline and never reported itself ready — invisibly, since
 * local typing kept working through a first-connect fallback. The visible
 * symptom was sharing a document and landing in an empty room.
 */

describe("decodeServerMsg", () => {
  it("accepts an empty history sent as an array", () => {
    const msg = decodeServerMsg({ History: { start: 0, operations: [] } });
    expect(msg).toEqual({ History: { start: 0, operations: [] } });
  });

  it("accepts an empty history sent as null", () => {
    // Exactly what a Go server emits for a brand-new room from a nil slice.
    const msg = decodeServerMsg({ History: { start: 0, operations: null } });
    expect(msg).toEqual({ History: { start: 0, operations: [] } });
  });

  it("accepts a history with operations", () => {
    const msg = decodeServerMsg({
      History: { start: 2, operations: [{ id: 7, operation: [3, "سلام", -1] }] },
    });
    if (!("History" in msg)) throw new Error("expected a History message");
    expect(msg.History.start).toBe(2);
    expect(msg.History.operations).toHaveLength(1);
    expect(msg.History.operations[0]!.id).toBe(7);
    expect(msg.History.operations[0]!.operation.toJSON()).toEqual([3, "سلام", -1]);
  });

  it("still rejects an operations field that is neither array nor null", () => {
    for (const bad of [42, "nope", { length: 1 }, true]) {
      expect(
        () => decodeServerMsg({ History: { start: 0, operations: bad } }),
        JSON.stringify(bad),
      ).toThrow(ProtocolError);
    }
  });

  it("decodes identity and presence messages", () => {
    expect(decodeServerMsg({ Identity: 3 })).toEqual({ Identity: 3 });

    const left = decodeServerMsg({ UserInfo: { id: 4, info: null } });
    if (!("UserInfo" in left)) throw new Error("expected a UserInfo message");
    expect(left.UserInfo).toEqual({ id: 4, info: null });

    const joined = decodeServerMsg({ UserInfo: { id: 5, info: { name: "هدهد", hue: 41 } } });
    if (!("UserInfo" in joined)) throw new Error("expected a UserInfo message");
    expect(joined.UserInfo.info).toEqual({ name: "هدهد", hue: 41 });
  });

  it("rejects a message that is not a known variant", () => {
    expect(() => decodeServerMsg({ Nonsense: 1 })).toThrow(ProtocolError);
    expect(() => decodeServerMsg(null)).toThrow(ProtocolError);
  });
});
