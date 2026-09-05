/**
 * The transport seam (PLAN.md §4.6): everything above this line — the OT
 * client, presence, undo, export — is identical whether talking to a real
 * room over a socket or to nobody at all. `WebSocketTransport` and
 * `LoopbackTransport` are the only two things that know a network exists.
 */

import { OpSeq } from "../ot";
import type { ClientMsg, ServerMsg } from "./types";
import { decodeServerMsg } from "./types";
import type { DocumentStore } from "./storage";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "local";

export interface Transport {
  send(msg: ClientMsg): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: ServerMsg) => void): () => void;
  /** Fires the current status immediately on subscribe, then on every change. */
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

type Unsub = () => void;

/** Shared pub-sub plumbing for the two Transport implementations below. */
abstract class BaseTransport implements Transport {
  private messageHandlers = new Set<(msg: ServerMsg) => void>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  protected status: ConnectionStatus;

  protected constructor(initialStatus: ConnectionStatus) {
    this.status = initialStatus;
  }

  abstract send(msg: ClientMsg): void;
  abstract close(): void;

  onMessage(cb: (msg: ServerMsg) => void): Unsub {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): Unsub {
    this.statusHandlers.add(cb);
    cb(this.status);
    return () => this.statusHandlers.delete(cb);
  }

  protected emit(msg: ServerMsg): void {
    for (const h of [...this.messageHandlers]) h(msg);
  }

  protected setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const h of [...this.statusHandlers]) h(next);
  }
}

// ---------------------------------------------------------------------------
// WebSocketTransport
// ---------------------------------------------------------------------------

/** RFC 6455 / coder/websocket's StatusPolicyViolation — a terminal close, not a drop to retry. */
const POLICY_VIOLATION_CODE = 1008;
const NORMAL_CLOSURE_CODE = 1000;

export interface WebSocketTransportOptions {
  /** Substitute WebSocket constructor, for tests. Defaults to the global `WebSocket`. */
  webSocketImpl?: typeof WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Overrides location-derived origin, for tests. */
  origin?: { protocol: string; host: string };
}

/**
 * Connects to `/api/socket/{roomId}`, deriving ws:// or wss:// from
 * `location.protocol` (PLAN.md §4.1). Reconnects with exponential backoff and
 * jitter, capped at `maxBackoffMs`, until explicitly closed. A server close
 * with the policy-violation code (rate limit, oversized doc, an operation
 * that could not be applied — see internal/server/conn.go's `fail`) is
 * terminal: retrying would just hit the same rejection in a hot loop, so it
 * surfaces as `offline` and stops, rather than reconnecting.
 */
export class WebSocketTransport extends BaseTransport {
  private ws: WebSocket | null = null;
  private closed = false;
  private terminal = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly url: string;
  private readonly impl: typeof WebSocket;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;

  constructor(roomId: string, options: WebSocketTransportOptions = {}) {
    super("connecting");

    const origin = options.origin ?? {
      protocol: typeof location !== "undefined" ? location.protocol : "http:",
      host: typeof location !== "undefined" ? location.host : "localhost",
    };
    const proto = origin.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${proto}//${origin.host}/api/socket/${encodeURIComponent(roomId)}`;

    this.impl = options.webSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket!;
    if (!this.impl) {
      throw new Error("WebSocketTransport: no WebSocket implementation available");
    }
    this.minBackoff = options.minBackoffMs ?? 500;
    this.maxBackoff = options.maxBackoffMs ?? 15_000;

    this.connect();
  }

  private connect(): void {
    if (this.closed || this.terminal) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = new this.impl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener("open", () => {
      this.attempt = 0;
      this.setStatus("connected");
    });

    socket.addEventListener("message", (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data as string);
      } catch {
        return; // not our protocol; ignore rather than tear down the connection
      }
      try {
        this.emit(decodeServerMsg(raw));
      } catch {
        // Malformed message from something claiming to be our server. Drop it;
        // do not let a bad message crash the session.
      }
    });

    socket.addEventListener("close", (ev: CloseEvent) => {
      this.ws = null;
      if (this.closed) return;
      if (ev.code === POLICY_VIOLATION_CODE) {
        this.terminal = true;
        this.setStatus("offline");
        return;
      }
      this.setStatus("offline");
      this.scheduleReconnect();
    });

    // "close" always follows "error" for a WebSocket; nothing extra to do here.
    socket.addEventListener("error", () => {});
  }

  private scheduleReconnect(): void {
    if (this.closed || this.terminal) return;
    const base = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.attempt);
    const jitter = base * (0.5 + Math.random() * 0.5);
    this.attempt++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => this.connect(), jitter);
  }

  send(msg: ClientMsg): void {
    if (!this.ws || this.ws.readyState !== this.impl.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(NORMAL_CLOSURE_CODE, "client closed");
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// LoopbackTransport
// ---------------------------------------------------------------------------

/**
 * Ids used only inside the loopback's synthetic protocol messages. Never sent
 * over any network — there is none — but kept distinct so session.ts's
 * ordinary "is this id mine?" ack classification works unmodified: SELF_ID is
 * used for the ack of our own edits, SEED_ID for the one synthetic history
 * entry that replays whatever was previously persisted.
 */
const LOOPBACK_SELF_ID = 1;
const LOOPBACK_SEED_ID = 0;

/**
 * The private-document transport (PLAN.md §4.6). Never opens a socket, never
 * emits presence, and acknowledges every Edit immediately at revision + 1.
 *
 * To satisfy the identical `Transport` contract as the real server, it speaks
 * the exact same bootstrap sequence: `Identity`, then a `History` from
 * revision 0. When a `DocumentStore` is supplied, that initial History
 * replays whatever was previously persisted as a single synthetic insert
 * operation (id `LOOPBACK_SEED_ID`) — which is what lets session.ts's normal
 * "rebuild the document from history" logic (see session.ts) double as the
 * private document's load path, with no special case.
 *
 * Sends that arrive before that bootstrap has completed (the store read is
 * necessarily async) are queued and replayed in order once it finishes, so
 * the persisted seed is always applied to this transport's internal document
 * before anything else touches it — this is what keeps a fast keystroke
 * during page load from racing the IndexedDB read.
 */
export class LoopbackTransport extends BaseTransport {
  private closed = false;
  private ready = false;
  private revision = 0;
  private text = "";
  private queued: ClientMsg[] = [];

  constructor(
    private readonly store?: DocumentStore,
    private readonly docId: string = "private",
  ) {
    super("local");
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    // Always yield at least once before emitting anything, even with no
    // store to await: the constructor returns to its caller (which then
    // subscribes via onMessage/onStatus) before this ever resumes. Skipping
    // this when there's no store would run the rest of this function
    // synchronously inside the constructor, emitting Identity/History to
    // zero listeners.
    await Promise.resolve();

    let seed = "";
    if (this.store) {
      try {
        seed = (await this.store.load(this.docId)) ?? "";
      } catch {
        // Storage is best-effort (PLAN.md item 4): private browsing, disabled
        // storage, and quota errors must degrade to an in-memory document
        // rather than breaking the editor.
        seed = "";
      }
    }
    if (this.closed) return;

    this.text = seed;
    this.emit({ Identity: LOOPBACK_SELF_ID });
    this.emit({
      History: {
        start: 0,
        operations:
          seed === ""
            ? []
            : [{ id: LOOPBACK_SEED_ID, operation: insertFromEmpty(seed) }],
      },
    });
    this.revision = seed === "" ? 0 : 1;
    this.ready = true;

    const pending = this.queued;
    this.queued = [];
    for (const msg of pending) this.dispatch(msg);
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    if (!this.ready) {
      this.queued.push(msg);
      return;
    }
    this.dispatch(msg);
  }

  private dispatch(msg: ClientMsg): void {
    if ("Edit" in msg) {
      const op = msg.Edit.operation;
      this.text = op.apply(this.text);
      this.revision++;
      this.emit({
        History: { start: this.revision - 1, operations: [{ id: LOOPBACK_SELF_ID, operation: op }] },
      });
      this.store?.scheduleSave(this.docId, this.text);
    }
    // ClientInfo / CursorData: private mode has no presence to broadcast.
  }

  close(): void {
    this.closed = true;
    this.store?.flush();
  }
}

function insertFromEmpty(text: string): OpSeq {
  return new OpSeq().insert(text);
}
