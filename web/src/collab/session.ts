/**
 * Ties client.ts (the OT state machine), transport.ts (the network seam) and
 * storage.ts together into the one thing the UI actually talks to: the
 * document text, presence, and connection status, as a framework-agnostic
 * `subscribe`-able store.
 *
 * ## Reconnect semantics — read this before changing anything below
 *
 * Per PLAN.md §4.1, a connection's first substantive message is `Identity`,
 * followed (if the room already has any operations) by a `History` replaying
 * the *entire* log from revision 0 — not just what changed since we last
 * spoke. That is true both for a brand-new connection and for a reconnect:
 * the server's per-connection `sentRevision` counter always starts at 0
 * (internal/server/conn.go), so there is no way to ask for "just what I
 * missed". Every (re)connect therefore replays history we may already know
 * part of.
 *
 * A first, tempting design is "reconstruct the document from History, diff
 * it against `this.text`, send the diff". That is wrong: it treats the
 * *entire* delta between the freshly-rebuilt document and our local text as
 * "our unsent edits", which is only true if nothing else in the room changed
 * since we were last in sync. If another participant edited concurrently
 * while we were offline, a whole-document diff silently overwrites their
 * change with a delete-and-reinsert of our own stale view — exactly the kind
 * of silent data loss this module exists to prevent, just aimed at someone
 * else's edit instead of our own. It also gets first-time joins wrong: a
 * viewer who has typed nothing yet has `this.text === ""`, and diffing that
 * against an existing room's real content computes "delete the whole room",
 * which must never be sent just because someone opened the page.
 *
 * The actual algorithm keeps a second piece of state, `syncedText` — a pure
 * mirror of the server's document, advanced only by operations we have
 * actually received (both remote ones and, once acked, our own), never by
 * our own optimistic local edits. `this.text` is always `syncedText` with
 * whatever local edits haven't been confirmed yet layered on top. That means
 * `diffText(syncedText, this.text)` is a clean, honest description of "what
 * *I* changed since I was last in sync" — nothing else can have leaked into
 * it. On (re)connect:
 *
 *   1. `localDelta = diffText(syncedText, this.text)` — our unconfirmed work,
 *      isolated from anything happening elsewhere in the room.
 *   2. Skip the leading operations in the new History we already knew about
 *      (`syncedText` accounts for them); call the rest `newOps` — genuinely
 *      new content, from any source, that arrived while we were away.
 *   3. Feed `localDelta` through a fresh `OTClient` as an ordinary local
 *      edit (this sends it immediately, at the revision `syncedText` was
 *      last confirmed at — a valid, if stale, revision the server rebases
 *      exactly as it would for any client that fell behind), then feed each
 *      of `newOps` through that same client's `applyServer`, exactly as the
 *      steady-state loop below does for a live remote op. Each step both
 *      properly rebases our still-outstanding edit *and* returns the op to
 *      apply to `this.text`, so a concurrent "insert at the front" and our
 *      own "append at the end" compose into one document with both changes
 *      — never one clobbering the other.
 *
 * When there is nothing unconfirmed, `localDelta` is a no-op and this
 * degenerates to exactly "adopt the room's current text" — which is what
 * happens for an ordinary first-time join. The diff itself is a
 * common-prefix / common-suffix trim in UTF-8 byte space (`diffText` below),
 * boundaries backed off to the nearest non-mid-character byte via
 * `floorBoundary` from `web/src/ot/utf8.ts` — the same technique PLAN.md
 * §5.2 specifies for the WYSIWYG bridge, reused here for the same reason:
 * whole-string diffing needs no UTF-16 offset math, only byte slicing.
 *
 * ## The empty-room gap in the reference protocol
 *
 * internal/server/conn.go's `pending()` only appends a `History` message when
 * `len(ops) > 0` — a brand-new, never-edited room sends *no* History at all,
 * ever, until *someone* makes the first edit. Taken literally, a client that
 * refuses to send anything until it has heard a History can never make that
 * first edit either: nobody would ever produce the message it's waiting for.
 * (Separately, a room restored from a SQLite snapshot seeds `Room.text`
 * directly without a corresponding synthetic operation in `Room.ops` —
 * internal/room/registry.go's `Get` — so a joining client replaying History
 * from revision 0 would reconstruct an empty document even though the room's
 * real text is not empty. Both are server-side gaps; internal/room is out of
 * this task's scope, so they're noted here rather than patched.)
 *
 * The resolution below only ever applies on the *first* connection this
 * session instance ever makes (`everBaselined` is false): if we need to send
 * before any real History has arrived, we run the exact same reconcile step
 * assuming revision 0 with no operations. That is safe precisely because it
 * is only used the first time — `syncedText` is still "", so there is
 * nothing on the server yet for it to collide with. A *genuine* reconnect
 * (`everBaselined` already true) never takes this shortcut: it always waits
 * for the real History, which is guaranteed to arrive, because the only way
 * `syncedText` could already be non-empty is that some earlier, real History
 * produced it — meaning the room's operation count is provably nonzero.
 *
 * While disconnected (`status` is anything but `connected`/`local`), local
 * edits only ever mutate `this.text`; they are never fed through the OT
 * client, which would require it to have a valid, current notion of the
 * synced document that it doesn't have mid-reconnect.
 */

import { OpSeq } from "../ot";
import { floorBoundary, isBoundary, utf8Encode, utf8Slice } from "../ot/utf8";
import { OTClient, transformCursor } from "./client";
import type { ConnectionStatus, Transport } from "./transport";
import type { ClientMsg, CursorData, HistoryMsg, ServerMsg, UserInfo } from "./types";

export interface Peer {
  id: number;
  info: UserInfo | null;
  cursor: CursorData | null;
}

export interface PresenceSnapshot {
  selfId: number | null;
  status: ConnectionStatus;
  /** True once the document has a real baseline (server or private seed) to edit against. */
  ready: boolean;
  peers: Peer[];
}

export type SessionListener = () => void;

const EMPTY_CURSOR: CursorData = { cursors: [], selections: [] };

export class CollabSession {
  private client = new OTClient(0);
  private _text: string;
  private _status: ConnectionStatus;
  private selfId: number | null = null;
  private localCursor: CursorData = EMPTY_CURSOR;
  private peers = new Map<number, Peer>();
  private listeners = new Set<SessionListener>();

  /**
   * A pure mirror of the server's document: advanced only by operations we
   * have actually been told about (never by our own optimistic local
   * edits). `this._text` is always `syncedText` plus whatever local edits
   * haven't been confirmed yet — see the module doc for why that split is
   * what makes reconnect reconciliation safe.
   */
  private syncedText = "";

  private connected: boolean;
  /** Have we established a baseline for the *current* connection episode? */
  private baselined = false;
  /** Have we ever established one, across any number of reconnects? */
  private everBaselined = false;

  private readonly unsubMessage: () => void;
  private readonly unsubStatus: () => void;

  constructor(
    private readonly transport: Transport,
    initialText = "",
  ) {
    this._text = initialText;
    this._status = "connecting";
    this.connected = false;
    this.unsubStatus = transport.onStatus((s) => this.handleStatus(s));
    this.unsubMessage = transport.onMessage((m) => this.handleMessage(m));
  }

  // -- public surface ---------------------------------------------------

  get text(): string {
    return this._text;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get presence(): PresenceSnapshot {
    return {
      selfId: this.selfId,
      status: this._status,
      ready: this.baselined,
      peers: [...this.peers.values()],
    };
  }

  get cursor(): CursorData {
    return this.localCursor;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply a local edit (already expressed as a byte-offset OpSeq against `this.text`). */
  applyLocalChange(op: OpSeq): void {
    const canDispatchNow = this.connected && (this.baselined || !this.everBaselined);

    if (canDispatchNow && !this.baselined) {
      this.establishBaseline(0, []); // first-ever connect, no real History seen yet — see module doc
    }

    this._text = op.apply(this._text);
    this.localCursor = transformCursor(this.localCursor, op);

    if (canDispatchNow) {
      const toSend = this.client.applyClient(op);
      if (toSend) this.sendEdit(toSend);
    }

    this.notify();
  }

  setCursor(cursors: number[], selections: [number, number][]): void {
    this.localCursor = { cursors, selections };
    this.transport.send({ CursorData: { cursors, selections } });
  }

  setName(name: string, hue: number): void {
    this.transport.send({ ClientInfo: { name, hue } });
  }

  close(): void {
    this.unsubMessage();
    this.unsubStatus();
    this.transport.close();
  }

  // -- transport callbacks ------------------------------------------------

  private handleStatus(s: ConnectionStatus): void {
    this._status = s;
    const nowConnected = s === "connected" || s === "local";
    if (nowConnected && !this.connected) {
      // A fresh connection episode: presence must be rebuilt from whatever
      // this new connection tells us — a peer who left while we were gone
      // will never be mentioned again, so stale entries must not linger.
      this.peers.clear();
    }
    if (!nowConnected) {
      // The moment we're no longer connected, the next History (whenever it
      // arrives) is a fresh baseline, not an incremental update — even if a
      // message slips in before `status` catches up to "connected" again.
      this.baselined = false;
    }
    this.connected = nowConnected;
    this.notify();
  }

  private handleMessage(msg: ServerMsg): void {
    if ("Identity" in msg) {
      this.selfId = msg.Identity;
      this.notify();
      return;
    }
    if ("History" in msg) {
      this.handleHistory(msg.History);
      return;
    }
    if ("UserInfo" in msg) {
      const { id, info } = msg.UserInfo;
      if (info === null) {
        this.peers.delete(id);
      } else {
        this.peers.set(id, { id, info, cursor: this.peers.get(id)?.cursor ?? null });
      }
      this.notify();
      return;
    }
    if ("UserCursor" in msg) {
      const { id, data } = msg.UserCursor;
      this.peers.set(id, { id, info: this.peers.get(id)?.info ?? null, cursor: data });
      this.notify();
    }
  }

  private handleHistory(h: HistoryMsg): void {
    if (!this.baselined) {
      this.establishBaseline(h.start, h.operations);
      this.notify();
      return;
    }

    for (const uop of h.operations) {
      if (uop.id === this.selfId) {
        const toSend = this.client.serverAck();
        if (toSend) this.sendEdit(toSend);
      } else {
        const applied = this.client.applyServer(uop.operation);
        this._text = applied.apply(this._text);
        this.localCursor = transformCursor(this.localCursor, applied);
      }
      // Every history entry, ours or not, is confirmed server state.
      this.syncedText = uop.operation.apply(this.syncedText);
    }
    this.notify();
  }

  /**
   * Establish (or re-establish, on reconnect) the OT client's baseline
   * against a History — real, or for a first-ever connect with nothing
   * heard yet, the assumed-empty synthetic one (see the module doc).
   *
   * `localDelta` isolates whatever we changed since `syncedText` was last
   * confirmed — nothing from elsewhere in the room can be mixed into it,
   * because `syncedText` only ever advances via confirmed history. Sending
   * it through a fresh `OTClient` seeded at our last confirmed revision, and
   * then replaying every history entry we did not already know about
   * through that same client's `applyServer`, rebases it against whatever
   * changed concurrently exactly the way a live remote edit would — so a
   * concurrent change elsewhere in the room and our own unconfirmed edit
   * both survive, composed into one document, rather than one clobbering
   * the other.
   */
  private establishBaseline(start: number, operations: HistoryMsg["operations"]): void {
    const oldRevision = this.client.revision;
    const fresh = new OTClient(oldRevision);

    const localDelta = diffText(this.syncedText, this._text);
    if (!localDelta.isNoop) {
      const toSend = fresh.applyClient(localDelta);
      if (toSend) this.sendEdit(toSend);
    }

    // `operations` covers absolute revisions [start, start + operations.length).
    // Everything before `oldRevision` is history we already folded into
    // `syncedText` on a previous pass; only the rest is genuinely new.
    const known = Math.min(Math.max(0, oldRevision - start), operations.length);
    for (const uop of operations.slice(known)) {
      const applied = fresh.applyServer(uop.operation);
      this._text = applied.apply(this._text);
      this.localCursor = transformCursor(this.localCursor, applied);
      this.syncedText = uop.operation.apply(this.syncedText);
    }

    this.client = fresh;
    this.baselined = true;
    this.everBaselined = true;
  }

  private sendEdit(operation: OpSeq): void {
    const msg: ClientMsg = { Edit: { revision: this.client.revision, operation } };
    this.transport.send(msg);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * The operation that turns `base` into `target`, as a common-prefix /
 * common-suffix trim performed in UTF-8 byte space (PLAN.md §5.2). Both trim
 * boundaries are backed off to the nearest byte that is not mid-character
 * with `floorBoundary`, so this never emits an op that splits a multi-byte
 * sequence — including a ZWNJ sitting right at the edge of the changed
 * region.
 */
export function diffText(base: string, target: string): OpSeq {
  const baseBytes = utf8Encode(base);
  const targetBytes = utf8Encode(target);
  const minLen = Math.min(baseBytes.length, targetBytes.length);

  let prefix = 0;
  while (prefix < minLen && baseBytes[prefix] === targetBytes[prefix]) prefix++;
  prefix = floorBoundary(baseBytes, prefix);

  const maxSuffix = minLen - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    baseBytes[baseBytes.length - 1 - suffix] === targetBytes[targetBytes.length - 1 - suffix]
  ) {
    suffix++;
  }
  // Shrink toward the middle (never grow) until the suffix start is a valid
  // boundary in *both* strings — their differing lengths mean a byte offset
  // that is safe from one end need not be safe measured from the other.
  while (
    suffix > 0 &&
    (!isBoundary(baseBytes, baseBytes.length - suffix) ||
      !isBoundary(targetBytes, targetBytes.length - suffix))
  ) {
    suffix--;
  }

  const op = new OpSeq();
  op.retain(prefix);
  const deleteCount = baseBytes.length - suffix - prefix;
  if (deleteCount > 0) op.delete(deleteCount);
  const inserted = utf8Slice(target, prefix, targetBytes.length - suffix);
  if (inserted !== "") op.insert(inserted);
  op.retain(suffix);
  return op;
}
