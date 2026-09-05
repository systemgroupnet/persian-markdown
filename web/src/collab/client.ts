/**
 * The OT client state machine — the standard three-state ot.js/Rustpad model.
 *
 * This module owns exactly one thing: deciding what to send and how to fold
 * an incoming server operation into whatever we have outstanding. It does not
 * own document text (that is session.ts's job — see the module comment
 * there for why the split matters for reconnect).
 *
 *   Synchronized
 *     applyClient(op)  -> send op now;                    become AwaitingConfirm(op)
 *     applyServer(op)  -> apply op locally;                stay Synchronized
 *
 *   AwaitingConfirm(outstanding)
 *     applyClient(op)  -> do NOT send;                    become AwaitingWithBuffer(outstanding, op)
 *     applyServer(op)  -> [outstanding', op'] = transform(outstanding, op)
 *                         apply op' locally;               become AwaitingConfirm(outstanding')
 *     serverAck()      ->                                  become Synchronized
 *
 *   AwaitingWithBuffer(outstanding, buffer)
 *     applyClient(op)  -> buffer := compose(buffer, op);   stay (still not sent)
 *     applyServer(op)  -> [outstanding', op1] = transform(outstanding, op)
 *                         [buffer', op2]      = transform(buffer, op1)
 *                         apply op2 locally;               become AwaitingWithBuffer(outstanding', buffer')
 *     serverAck()      -> send buffer;                     become AwaitingConfirm(buffer)
 *
 * `revision` advances by exactly one on every server message that moves
 * history forward, whether that message is an ack of our own edit or a
 * remote one — both `applyServer` and `serverAck` increment it. An operation
 * is always sent tagged with the revision it was composed against, i.e. the
 * value of `revision` at the moment `applyClient` decided to send.
 */

import { OpSeq, OTError, compose, transform } from "../ot";
import type { CursorData } from "./types";

type ClientState =
  | { readonly kind: "synchronized" }
  | { readonly kind: "awaitingConfirm"; readonly outstanding: OpSeq }
  | { readonly kind: "awaitingWithBuffer"; readonly outstanding: OpSeq; readonly buffer: OpSeq };

export class OTClient {
  private state: ClientState = { kind: "synchronized" };

  constructor(private _revision: number) {}

  get revision(): number {
    return this._revision;
  }

  get isSynchronized(): boolean {
    return this.state.kind === "synchronized";
  }

  /** True while there is an operation sent but not yet acknowledged. */
  get hasOutstanding(): boolean {
    return this.state.kind !== "synchronized";
  }

  /**
   * A local edit was made. Returns the operation to send immediately, or
   * `null` if it was folded into a buffer awaiting the previous ack instead.
   */
  applyClient(op: OpSeq): OpSeq | null {
    switch (this.state.kind) {
      case "synchronized":
        this.state = { kind: "awaitingConfirm", outstanding: op };
        return op;

      case "awaitingConfirm":
        this.state = { kind: "awaitingWithBuffer", outstanding: this.state.outstanding, buffer: op };
        return null;

      case "awaitingWithBuffer": {
        const composed = compose(this.state.buffer, op);
        this.state = { kind: "awaitingWithBuffer", outstanding: this.state.outstanding, buffer: composed };
        return null;
      }
    }
  }

  /**
   * A remote operation arrived from the server (not an ack of our own).
   * Advances `revision` by one and returns the operation to apply to the
   * local document (and to any locally-tracked cursor, via
   * `transformCursor`), already transformed through whatever we have
   * outstanding.
   */
  applyServer(op: OpSeq): OpSeq {
    this._revision++;

    switch (this.state.kind) {
      case "synchronized":
        return op;

      case "awaitingConfirm": {
        const [outstandingPrime, opPrime] = transform(this.state.outstanding, op);
        this.state = { kind: "awaitingConfirm", outstanding: outstandingPrime };
        return opPrime;
      }

      case "awaitingWithBuffer": {
        const [outstandingPrime, opPrime1] = transform(this.state.outstanding, op);
        const [bufferPrime, opPrime2] = transform(this.state.buffer, opPrime1);
        this.state = { kind: "awaitingWithBuffer", outstanding: outstandingPrime, buffer: bufferPrime };
        return opPrime2;
      }
    }
  }

  /**
   * The server confirmed our outstanding operation. Advances `revision` by
   * one. Returns the buffered operation to send next, if one had
   * accumulated while we waited, else `null`.
   */
  serverAck(): OpSeq | null {
    this._revision++;

    switch (this.state.kind) {
      case "synchronized":
        throw new OTError("OTClient: serverAck received with no outstanding operation");

      case "awaitingConfirm":
        this.state = { kind: "synchronized" };
        return null;

      case "awaitingWithBuffer": {
        const { buffer } = this.state;
        this.state = { kind: "awaitingConfirm", outstanding: buffer };
        return buffer;
      }
    }
  }
}

/**
 * Map a cursor/selection set through an operation.
 *
 * Mirrors `transformCursor` in internal/room/room.go byte for byte: a
 * position inside a deleted range collapses to the start of that range. Used
 * by session.ts to keep the local caret in the right place both when a
 * remote edit arrives and when reconciling after a reconnect.
 */
export function transformCursor(data: CursorData, op: OpSeq): CursorData {
  return {
    cursors: data.cursors.map((p) => op.transformIndex(p)),
    selections: data.selections.map(([a, b]) => op.transformRange(a, b)),
  };
}
