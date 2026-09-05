/**
 * Room addressing: which document is this browser looking at?
 *
 * Two kinds exist (PLAN.md §4.6). No hash means the private local document —
 * stored in IndexedDB, never sent anywhere. A hash means a shared room that
 * anyone holding the link can read and edit.
 *
 * WHY THE HASH AND NOT A PATH. A fragment is never transmitted in a request
 * line, so room ids stay out of server access logs and out of the `Referer`
 * header when a user follows a link in their document to somewhere else. With
 * no accounts and no authentication, an unguessable id is the ONLY thing
 * standing between a document and the public, so keeping it off the wire is
 * worth the slightly less tidy URL. This settles PLAN.md §10 open item 3.
 *
 * Ids are still not secrets. They are unlisted and infeasible to guess, which
 * is obscurity, not security — the About dialog says so plainly.
 */

import { nanoid } from "nanoid";

/** Length of a minted id: 10 chars from nanoid's 64-char alphabet ≈ 60 bits. */
const ID_LENGTH = 10;

/**
 * Must agree with `idPattern` in internal/room/registry.go. The server rejects
 * anything else before it touches the registry, so a client that mints an id
 * outside this shape would produce a link that simply fails to open.
 *
 * nanoid's default alphabet (A-Za-z0-9_-) is a subset of this by construction.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,24}$/;

export type RoomLocation = { kind: "private" } | { kind: "shared"; id: string };

export function isValidRoomId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function mintRoomId(): string {
  return nanoid(ID_LENGTH);
}

/**
 * Parse a location hash into a room.
 *
 * A malformed hash resolves to the private document rather than throwing or
 * showing an error page: someone who mistypes a link should land somewhere
 * usable, and the alternative is a dead end with no way forward.
 */
export function readLocation(hash: string): RoomLocation {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return { kind: "private" };

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape is not worth failing over.
  }

  return isValidRoomId(decoded) ? { kind: "shared", id: decoded } : { kind: "private" };
}

/** The shareable absolute URL for a room. */
export function shareUrl(id: string, origin?: string): string {
  const base = origin ?? (typeof location !== "undefined" ? location.origin + location.pathname : "");
  return `${base}#${id}`;
}

/** Navigate to a room, adding a history entry so Back returns to the previous one. */
export function goToRoom(id: string): void {
  window.location.hash = id;
}

/**
 * Navigate to the private document.
 *
 * Uses replaceState rather than clearing the hash directly: assigning "" to
 * location.hash leaves a bare "#" in the address bar, which then reads as a
 * shared room with an empty id on the next parse.
 */
export function goToPrivate(): void {
  window.history.pushState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Subscribe to room changes. Returns an unsubscribe function. */
export function onLocationChange(listener: (loc: RoomLocation) => void): () => void {
  const handler = () => listener(readLocation(window.location.hash));
  window.addEventListener("hashchange", handler);
  window.addEventListener("popstate", handler);
  return () => {
    window.removeEventListener("hashchange", handler);
    window.removeEventListener("popstate", handler);
  };
}

export function currentLocation(): RoomLocation {
  if (typeof window === "undefined") return { kind: "private" };
  return readLocation(window.location.hash);
}
