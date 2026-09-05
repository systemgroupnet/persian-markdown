/**
 * TypeScript mirror of internal/room/protocol.go.
 *
 * The wire protocol is externally tagged: every message is an object with
 * exactly one populated key naming its variant (`{Edit: {...}}`, never a
 * `{type: "Edit", ...}` discriminant field). This matches Go's
 * `json:"Edit,omitempty"` struct-of-pointers encoding exactly, so the two
 * sides never need a translation layer beyond "does this key exist".
 *
 * `operation` fields carry `OpSeq` instances. `OpSeq.toJSON()` already
 * produces the ot.js wire array (positive = retain, negative = delete,
 * string = insert), so `JSON.stringify` on a `ClientMsg` needs nothing
 * special. The other direction — untrusted bytes off the wire — is not so
 * lucky: everything in `decodeServerMsg` assumes nothing about its input,
 * per protocol.go's own warning that nothing here may be assumed well-formed
 * just because it parsed as JSON.
 */

import { OpSeq } from "../ot";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface UserInfo {
  name: string;
  hue: number;
}

/** Offsets are UTF-8 byte positions in the document (PLAN.md §3.2). */
export interface CursorData {
  cursors: number[];
  selections: [number, number][];
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface EditMsg {
  revision: number;
  operation: OpSeq;
}

export type ClientMsg =
  | { Edit: EditMsg }
  | { ClientInfo: UserInfo }
  | { CursorData: CursorData };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface UserOperation {
  id: number;
  operation: OpSeq;
}

export interface HistoryMsg {
  start: number;
  operations: UserOperation[];
}

/** A null `info` means the participant left — it is a meaningful value, not "absent". */
export interface UserInfoMsg {
  id: number;
  info: UserInfo | null;
}

export interface UserCursorMsg {
  id: number;
  data: CursorData;
}

export type ServerMsg =
  | { Identity: number }
  | { History: HistoryMsg }
  | { UserInfo: UserInfoMsg }
  | { UserCursor: UserCursorMsg };

// ---------------------------------------------------------------------------
// Decoding untrusted input
// ---------------------------------------------------------------------------

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

function asRecord(v: unknown, ctx: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ProtocolError(`${ctx} must be an object`);
  }
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, ctx: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ProtocolError(`${ctx} must be a finite number`);
  }
  return v;
}

function asString(v: unknown, ctx: string): string {
  if (typeof v !== "string") throw new ProtocolError(`${ctx} must be a string`);
  return v;
}

function asNumberArray(v: unknown, ctx: string): number[] {
  if (!Array.isArray(v)) throw new ProtocolError(`${ctx} must be an array`);
  return v.map((x, i) => asNumber(x, `${ctx}[${i}]`));
}

function asSelections(v: unknown, ctx: string): [number, number][] {
  if (!Array.isArray(v)) throw new ProtocolError(`${ctx} must be an array`);
  return v.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new ProtocolError(`${ctx}[${i}] must be a [number, number] pair`);
    }
    return [asNumber(pair[0], `${ctx}[${i}][0]`), asNumber(pair[1], `${ctx}[${i}][1]`)];
  });
}

export function decodeUserInfo(v: unknown): UserInfo {
  const r = asRecord(v, "UserInfo");
  return { name: asString(r.name, "UserInfo.name"), hue: asNumber(r.hue, "UserInfo.hue") };
}

export function decodeCursorData(v: unknown): CursorData {
  const r = asRecord(v, "CursorData");
  return {
    cursors: asNumberArray(r.cursors, "CursorData.cursors"),
    selections: asSelections(r.selections, "CursorData.selections"),
  };
}

function decodeUserOperation(v: unknown): UserOperation {
  const r = asRecord(v, "UserOperation");
  return { id: asNumber(r.id, "UserOperation.id"), operation: OpSeq.fromJSON(r.operation) };
}

function decodeHistory(v: unknown): HistoryMsg {
  const r = asRecord(v, "History");
  const opsRaw = r.operations;
  if (!Array.isArray(opsRaw)) throw new ProtocolError("History.operations must be an array");
  return { start: asNumber(r.start, "History.start"), operations: opsRaw.map(decodeUserOperation) };
}

/**
 * Parse and validate a `ServerMsg` from an already-JSON.parsed value.
 *
 * Throws `ProtocolError` on anything that does not match the expected shape,
 * rather than silently coercing — a malformed message from a "server" means
 * something is badly wrong (a bug, or not our server at all), and propagating
 * a half-understood message would risk corrupting the document.
 */
export function decodeServerMsg(raw: unknown): ServerMsg {
  const r = asRecord(raw, "ServerMsg");

  if (r.Identity !== undefined) return { Identity: asNumber(r.Identity, "Identity") };

  if (r.History !== undefined) return { History: decodeHistory(r.History) };

  if (r.UserInfo !== undefined) {
    const u = asRecord(r.UserInfo, "UserInfo");
    const info = u.info === null || u.info === undefined ? null : decodeUserInfo(u.info);
    return { UserInfo: { id: asNumber(u.id, "UserInfo.id"), info } };
  }

  if (r.UserCursor !== undefined) {
    const u = asRecord(r.UserCursor, "UserCursor");
    return {
      UserCursor: { id: asNumber(u.id, "UserCursor.id"), data: decodeCursorData(u.data) },
    };
  }

  throw new ProtocolError("unrecognised ServerMsg: no known tag present");
}

/** Encode a ClientMsg for the wire. OpSeq.toJSON() makes this a plain JSON.stringify. */
export function encodeClientMsg(msg: ClientMsg): string {
  return JSON.stringify(msg);
}
