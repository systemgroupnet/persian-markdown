/**
 * Public surface of the collaboration layer.
 *
 * The application composes exactly three things from here: a transport (which
 * is the entire difference between a private document and a shared room), a
 * CollabSession wrapping it, and the presence types needed to render peers.
 * Everything else — the OT client state machine, the wire codec, the storage
 * adapter — is an implementation detail and stays unexported.
 */

export { CollabSession } from "./session";
export type { Peer, PresenceSnapshot, SessionListener } from "./session";

export { WebSocketTransport, LoopbackTransport } from "./transport";
export type { Transport, ConnectionStatus, WebSocketTransportOptions } from "./transport";

export { IndexedDBStore } from "./storage";
export type { DocumentStore } from "./storage";

export { cursorColor, selectionColor } from "./names";

export type { UserInfo, CursorData } from "./types";
