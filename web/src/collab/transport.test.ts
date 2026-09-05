import { describe, expect, it, vi } from "vitest";

import { LoopbackTransport, WebSocketTransport } from "./transport";
import type { ConnectionStatus } from "./transport";
import type { DocumentStore } from "./storage";

type Listener = (ev: unknown) => void;

/** Just enough of the DOM WebSocket surface for WebSocketTransport to drive. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }

  // -- test-only driving surface --
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }
  serverMessage(data: unknown): void {
    this.dispatch("message", { data: JSON.stringify(data) });
  }
  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason: "" });
  }

  private dispatch(type: string, ev: unknown): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(ev);
  }
}

function latest(): FakeWebSocket {
  return FakeWebSocket.instances.at(-1)!;
}

describe("WebSocketTransport", () => {
  it("connects to /api/socket/{roomId}, deriving ws:// from http:", () => {
    FakeWebSocket.reset();
    const t = new WebSocketTransport("abc123", {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      origin: { protocol: "http:", host: "example.test" },
    });
    expect(latest().url).toBe("ws://example.test/api/socket/abc123");
    t.close();
  });

  it("derives wss:// from https:", () => {
    FakeWebSocket.reset();
    const t = new WebSocketTransport("abc123", {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      origin: { protocol: "https:", host: "example.test" },
    });
    expect(latest().url).toBe("wss://example.test/api/socket/abc123");
    t.close();
  });

  it("reports connecting -> connected, forwards decoded messages, and sends only while open", () => {
    FakeWebSocket.reset();
    const statuses: ConnectionStatus[] = [];
    const t = new WebSocketTransport("room", {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      origin: { protocol: "http:", host: "x" },
    });
    t.onStatus((s) => statuses.push(s));
    expect(statuses).toEqual(["connecting"]);

    // Sending before the socket is open is silently dropped, not queued or thrown.
    expect(() => t.send({ ClientInfo: { name: "x", hue: 1 } })).not.toThrow();
    expect(latest().sent).toEqual([]);

    latest().serverOpen();
    expect(statuses).toEqual(["connecting", "connected"]);

    const received: unknown[] = [];
    t.onMessage((m) => received.push(m));
    latest().serverMessage({ Identity: 7 });
    expect(received).toEqual([{ Identity: 7 }]);

    t.send({ ClientInfo: { name: "یوزپلنگ", hue: 214 } });
    expect(latest().sent).toEqual([JSON.stringify({ ClientInfo: { name: "یوزپلنگ", hue: 214 } })]);

    t.close();
  });

  it("drops a message that fails to decode instead of crashing the session", () => {
    FakeWebSocket.reset();
    const t = new WebSocketTransport("room", {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      origin: { protocol: "http:", host: "x" },
    });
    latest().serverOpen();
    const received: unknown[] = [];
    t.onMessage((m) => received.push(m));

    latest().serverMessage({ NotARealTag: 1 });
    expect(received).toEqual([]); // dropped, not thrown

    latest().serverMessage({ Identity: 1 });
    expect(received).toEqual([{ Identity: 1 }]); // subsequent good messages still get through

    t.close();
  });

  it("reconnects with backoff after a non-policy close, and does not after an explicit close()", () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.reset();
      const statuses: ConnectionStatus[] = [];
      const t = new WebSocketTransport("room", {
        webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        origin: { protocol: "http:", host: "x" },
        minBackoffMs: 100,
        maxBackoffMs: 1000,
      });
      t.onStatus((s) => statuses.push(s));
      latest().serverOpen();
      expect(FakeWebSocket.instances).toHaveLength(1);

      latest().serverClose(1006); // abnormal closure — should retry
      // setStatus("offline") fires first, then scheduleReconnect immediately
      // flips to "reconnecting" while it waits out the backoff timer.
      expect(statuses).toContain("offline");
      expect(statuses.at(-1)).toBe("reconnecting");

      vi.advanceTimersByTime(2000);
      expect(FakeWebSocket.instances.length).toBeGreaterThan(1); // reconnected

      const beforeExplicitClose = FakeWebSocket.instances.length;
      t.close();
      latest().serverClose(1006); // even if the old socket still fires close, no further reconnect
      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances.length).toBe(beforeExplicitClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a policy-violation close as terminal and does not reconnect", () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.reset();
      const statuses: ConnectionStatus[] = [];
      const t = new WebSocketTransport("room", {
        webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        origin: { protocol: "http:", host: "x" },
        minBackoffMs: 50,
        maxBackoffMs: 200,
      });
      t.onStatus((s) => statuses.push(s));
      latest().serverOpen();

      latest().serverClose(1008); // StatusPolicyViolation
      expect(statuses.at(-1)).toBe("offline");

      const count = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances.length).toBe(count); // never retried
      expect(statuses.filter((s) => s === "reconnecting")).toEqual([]);

      t.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LoopbackTransport", () => {
  it("never opens a socket and reports status 'local' immediately", () => {
    const t = new LoopbackTransport();
    const statuses: ConnectionStatus[] = [];
    t.onStatus((s) => statuses.push(s));
    expect(statuses).toEqual(["local"]);
    t.close();
  });

  it("ignores ClientInfo and CursorData without ever emitting presence", async () => {
    const t = new LoopbackTransport();
    const received: unknown[] = [];
    t.onMessage((m) => received.push(m));
    await new Promise((r) => setTimeout(r, 0));

    t.send({ ClientInfo: { name: "x", hue: 1 } });
    t.send({ CursorData: { cursors: [0], selections: [] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(received.some((m) => typeof m === "object" && m !== null && "UserInfo" in m)).toBe(false);
    expect(received.some((m) => typeof m === "object" && m !== null && "UserCursor" in m)).toBe(false);
    t.close();
  });

  it("degrades to an empty seed when the store rejects, rather than throwing", async () => {
    const brokenStore: DocumentStore = {
      load: () => Promise.reject(new Error("boom")),
      scheduleSave: () => {},
      flush: () => {},
    };
    const t = new LoopbackTransport(brokenStore, "doc");
    const messages: unknown[] = [];
    t.onMessage((m) => messages.push(m));
    await new Promise((r) => setTimeout(r, 0));

    expect(messages[0]).toEqual({ Identity: 1 });
    expect(messages[1]).toEqual({ History: { start: 0, operations: [] } });
    t.close();
  });
});
