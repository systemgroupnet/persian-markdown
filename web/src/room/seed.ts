/**
 * Handing a document's text from the private scratchpad to a freshly minted
 * shared room.
 *
 * Sharing copies the local document into a new room (PLAN.md §4.6), but the
 * two live in different sessions: the private one talks to IndexedDB through a
 * loopback transport, the shared one to the server over a websocket. The text
 * has to survive the moment between them, which is what this module is for.
 *
 * The rule that matters is that a stashed seed is consumed ONLY when a
 * decision about it has actually been made against the session it belongs to.
 * An earlier version cleared the key first and then checked whether it could
 * apply; when the check ran a render too early — while the location already
 * said "shared" but the private session was still current — the guard failed
 * and the text was destroyed with no way to recover it. Hence `decideSeed`
 * below being a pure function with an explicit "wait" outcome.
 */

const PREFIX = "pmd:seed:";

function key(roomId: string): string {
  return PREFIX + roomId;
}

/**
 * sessionStorage throws outright in some privacy modes, so every access is
 * guarded. Losing a seed degrades to "the new room starts empty"; the private
 * document is untouched either way and remains at the app root.
 */
export function stashSeed(roomId: string, text: string): void {
  try {
    sessionStorage.setItem(key(roomId), text);
  } catch {
    // Not fatal: the room simply opens empty.
  }
}

export function peekSeed(roomId: string): string | null {
  try {
    return sessionStorage.getItem(key(roomId));
  } catch {
    return null;
  }
}

export function clearSeed(roomId: string): void {
  try {
    sessionStorage.removeItem(key(roomId));
  } catch {
    // Nothing to do; a stale key is harmless because room ids are single-use.
  }
}

export type SeedDecision =
  /** No seed was stashed for this room. */
  | "none"
  /** A seed exists but the session cannot accept it yet. Do not consume it. */
  | "wait"
  /** Insert the seed into the empty document, then consume it. */
  | "apply"
  /** The seed cannot or need not be applied. Consume it. */
  | "discard";

/**
 * Whether a stashed seed can be written into a session yet.
 *
 * Pure and exhaustively tested, because the failure it guards against is
 * silent: getting this wrong destroys a document the user believed they were
 * sharing, and nothing downstream can tell that it happened.
 */
export function decideSeed(input: {
  seed: string | null;
  /** Has the session established a real baseline to edit against? */
  ready: boolean;
  /** Is the session's document currently empty? */
  documentIsEmpty: boolean;
}): SeedDecision {
  if (input.seed === null) return "none";

  // The session has no agreed starting point yet, so an insert would be
  // composed against a revision the server may not share. Keep the seed.
  if (!input.ready) return "wait";

  // An empty seed carries nothing, and a room that already has content must
  // not be overwritten by a late-arriving handoff.
  if (input.seed === "" || !input.documentIsEmpty) return "discard";

  return "apply";
}
