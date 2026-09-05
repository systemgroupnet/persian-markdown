/**
 * The React binding between a CollabSession and the editor views.
 *
 * This is the ONE place in the frontend where UTF-16 becomes UTF-8 and back
 * (PLAN.md §3.2). Views speak UTF-16 because that is the only unit CodeMirror
 * and Slate have; the protocol speaks UTF-8 bytes because that is what Go
 * slices natively. Keeping the conversion in a single module — rather than
 * letting each view do its own — is what makes the rule auditable, and it is
 * the mitigation for the highest-severity risk in the plan.
 *
 * It also chooses the transport, which is the whole of "private mode": a
 * LoopbackTransport instead of a WebSocketTransport, and every other line of
 * the application is unchanged (PLAN.md §4.6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CollabSession,
  IndexedDBStore,
  LoopbackTransport,
  WebSocketTransport,
  type ConnectionStatus,
  type Peer,
  type Transport,
} from "@/collab";
import { OffsetIndex, OpSeq } from "@/ot";
import type { RemoteCursor, TextChange, LocalSelection } from "@/views/types";
import type { RoomLocation } from "@/room/location";
import { clearSeed, decideSeed, peekSeed } from "@/room/seed";

const PRIVATE_DOC_ID = "private";

export interface CollabDocument {
  text: string;
  status: ConnectionStatus;
  ready: boolean;
  selfId: number | null;
  peers: Peer[];
  remoteCursors: RemoteCursor[];
  applyChange: (change: TextChange) => void;
  setSelection: (selection: LocalSelection) => void;
}

export function useCollabDocument(location: RoomLocation): CollabDocument {
  const [session, setSession] = useState<CollabSession | null>(null);
  // A counter rather than the text itself: CollabSession is the source of
  // truth, and mirroring its text into state would let the two disagree.
  const [, bump] = useState(0);

  // The index is kept in step with the session's text so conversions stay
  // O(line) instead of O(document) on every keystroke.
  const indexRef = useRef(new OffsetIndex(""));

  useEffect(() => {
    let transport: Transport;
    if (location.kind === "private") {
      // Storage failures degrade to memory rather than throwing, so a browser
      // with IndexedDB blocked still gets a working (if unsaved) editor.
      transport = new LoopbackTransport(new IndexedDBStore(), PRIVATE_DOC_ID);
    } else {
      transport = new WebSocketTransport(location.id);
    }

    const next = new CollabSession(transport);
    setSession(next);
    indexRef.current = new OffsetIndex(next.text);

    /*
     * Seeding a freshly shared room happens here, against `next`, rather than
     * in a component effect reading `doc.text`.
     *
     * The location changes synchronously on a hash change, but the session is
     * replaced by this effect. A component effect keyed on the location
     * therefore runs at least once while the PREVIOUS session is still
     * current — for a share that is the private document, whose text is not
     * empty. The old code consumed the stashed seed on that render and then
     * failed its own "document is empty" guard, destroying the text it was
     * carrying. Deciding here means the session under inspection is always the
     * one the seed was stashed for.
     */
    let seedSettled = location.kind !== "shared";

    const considerSeed = () => {
      if (seedSettled || location.kind !== "shared") return;

      const decision = decideSeed({
        seed: peekSeed(location.id),
        ready: next.presence.ready,
        documentIsEmpty: next.text === "",
      });

      // "wait" is the important branch: leave the seed untouched so a later
      // update can still apply it.
      if (decision === "wait") return;

      seedSettled = true;
      if (decision === "apply") {
        const seed = peekSeed(location.id) ?? "";
        const op = new OpSeq();
        op.insert(seed);
        next.applyLocalChange(op);
      }
      if (decision !== "none") clearSeed(location.id);
    };

    const unsubscribe = next.subscribe(() => {
      // Resync the index whenever the session's text moves for any reason —
      // remote operations included.
      if (indexRef.current.document !== next.text) {
        indexRef.current.reset(next.text);
      }
      considerSeed();
      bump((n) => n + 1);
    });

    considerSeed();

    return () => {
      unsubscribe();
      next.close();
    };
  }, [location.kind, location.kind === "shared" ? location.id : ""]);

  const applyChange = useCallback(
    (change: TextChange) => {
      if (!session) return;

      const index = indexRef.current;
      // Convert the view's UTF-16 offsets exactly once, here.
      const from = index.toBytes(change.from);
      const to = index.toBytes(change.to);
      const total = index.byteLength;

      const op = new OpSeq();
      op.retain(from);
      op.delete(to - from);
      op.insert(change.insert);
      op.retain(total - to);

      session.applyLocalChange(op);
    },
    [session],
  );

  const setSelection = useCallback(
    (selection: LocalSelection) => {
      if (!session) return;
      const index = indexRef.current;
      const cursors = [index.toBytes(selection.pos)];
      const selections: [number, number][] = selection.selection
        ? [[index.toBytes(selection.selection.from), index.toBytes(selection.selection.to)]]
        : [];
      session.setCursor(cursors, selections);
    },
    [session],
  );

  const presence = session?.presence;
  const text = session?.text ?? "";

  const remoteCursors = useMemo<RemoteCursor[]>(() => {
    if (!presence) return [];
    const index = indexRef.current;

    return presence.peers.flatMap((peer) => {
      if (peer.id === presence.selfId || !peer.info || !peer.cursor) return [];

      const caret = peer.cursor.cursors[0];
      if (caret === undefined) return [];

      // A byte offset from a peer can land mid-character if that peer is
      // buggy, or simply be stale relative to our text. Neither is worth
      // breaking the render over — drop the cursor and keep editing.
      try {
        const range = peer.cursor.selections[0];
        return [
          {
            id: peer.id,
            name: peer.info.name,
            hue: peer.info.hue,
            pos: index.toUnits(caret),
            selection: range
              ? { from: index.toUnits(range[0]), to: index.toUnits(range[1]) }
              : undefined,
          },
        ];
      } catch {
        return [];
      }
    });
  }, [presence, text]);

  return {
    text,
    status: presence?.status ?? "connecting",
    ready: presence?.ready ?? false,
    selfId: presence?.selfId ?? null,
    peers: presence?.peers ?? [],
    remoteCursors,
    applyChange,
    setSelection,
  };
}
