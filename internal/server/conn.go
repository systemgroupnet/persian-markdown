package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/systemgroupnet/persian-markdown/internal/room"
)

// conn is one participant's socket.
//
// Reading and writing run in separate goroutines, which is the only way to
// serve a client that is slow to read without also being slow to accept their
// edits. The write side owns all sending; nothing else in the process ever
// touches the socket, so coder/websocket's single-writer requirement is
// satisfied structurally rather than by a mutex.
type conn struct {
	ws   *websocket.Conn
	rm   *room.Room
	id   uint64
	log  *slog.Logger
	lim  *rateLimiter
	maxD int

	// State the write loop keeps so it can compute what this participant has
	// not yet been told. It is owned exclusively by the write loop.
	sentRevision int
	sentUsers    map[uint64]room.UserInfo
	sentCursors  map[uint64]room.CursorData
	sentInitial  bool
}

func (c *conn) run(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	errs := make(chan error, 2)
	go func() { errs <- c.writeLoop(ctx) }()
	go func() { errs <- c.readLoop(ctx) }()

	// Whichever side fails first ends the connection; cancel stops the other.
	err := <-errs
	cancel()
	<-errs
	return err
}

// readLoop consumes client messages until the socket closes.
func (c *conn) readLoop(ctx context.Context) error {
	for {
		var msg room.ClientMsg
		if err := wsjson.Read(ctx, c.ws, &msg); err != nil {
			return err
		}

		switch {
		case msg.Edit != nil:
			if !c.lim.allow() {
				// Rate limiting closes rather than silently dropping: a client
				// whose edits are discarded would keep a revision the server
				// never reached and diverge invisibly. Reconnecting resyncs.
				return c.fail(websocket.StatusPolicyViolation, "edit rate limit exceeded")
			}
			if msg.Edit.Operation == nil {
				return c.fail(websocket.StatusUnsupportedData, "edit without an operation")
			}
			err := c.rm.ApplyEdit(c.id, msg.Edit.Revision, msg.Edit.Operation)
			switch {
			case err == nil:
			case errors.Is(err, room.ErrTooLarge):
				return c.fail(websocket.StatusPolicyViolation, "document size limit reached")
			case errors.Is(err, room.ErrRevisionOutOfRange):
				return c.fail(websocket.StatusUnsupportedData, "revision out of range")
			default:
				// A malformed or non-composable operation means this client's
				// view of the document is not one we can reconcile.
				c.log.Warn("rejecting edit", "user", c.id, "err", err)
				return c.fail(websocket.StatusUnsupportedData, "operation could not be applied")
			}

		case msg.ClientInfo != nil:
			c.rm.SetInfo(c.id, *msg.ClientInfo)

		case msg.CursorData != nil:
			c.rm.SetCursor(c.id, *msg.CursorData)
		}
	}
}

// writeLoop pushes room state to the client whenever the room changes.
//
// It never blocks the room: it reads a snapshot, sends it, then waits. If it
// falls behind it simply skips intermediate states, because every message it
// sends is derived from current state rather than from a queue of past events.
func (c *conn) writeLoop(ctx context.Context) error {
	if err := c.send(ctx, identity(c.id)); err != nil {
		return err
	}

	for {
		// Take the wakeup channel *before* reading state, so an update landing
		// between the read and the wait cannot be missed.
		changed := c.rm.Changes()

		for _, msg := range c.pending() {
			if err := c.send(ctx, msg); err != nil {
				return err
			}
		}

		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// pending computes the messages needed to bring this client up to date.
func (c *conn) pending() []room.ServerMsg {
	var out []room.ServerMsg

	// The first History is always sent, even when empty. It is the client's
	// definitive "you are synchronised at revision N" signal; without it, a
	// client joining a brand-new room could not distinguish "nothing to replay"
	// from "the server has not told me yet", and would have to guess.
	if start, ops := c.rm.HistorySince(c.sentRevision); len(ops) > 0 || !c.sentInitial {
		out = append(out, room.ServerMsg{
			History: &room.HistoryMsg{Start: start, Operations: ops},
		})
		c.sentRevision = start + len(ops)
		c.sentInitial = true
	}

	users := c.rm.Users()
	for id, info := range users {
		if prev, ok := c.sentUsers[id]; !ok || prev != info {
			info := info
			out = append(out, room.ServerMsg{
				UserInfo: &room.UserInfoMsg{ID: id, Info: &info},
			})
			c.sentUsers[id] = info
		}
	}
	for id := range c.sentUsers {
		if _, still := users[id]; !still {
			out = append(out, room.ServerMsg{
				UserInfo: &room.UserInfoMsg{ID: id, Info: nil}, // null ⇒ left
			})
			delete(c.sentUsers, id)
			delete(c.sentCursors, id)
		}
	}

	for id, data := range c.rm.Cursors() {
		if id == c.id {
			continue // clients render their own caret locally
		}
		if prev, ok := c.sentCursors[id]; !ok || !sameCursor(prev, data) {
			out = append(out, room.ServerMsg{
				UserCursor: &room.UserCursorMsg{ID: id, Data: data},
			})
			c.sentCursors[id] = data
		}
	}

	return out
}

func (c *conn) send(ctx context.Context, msg room.ServerMsg) error {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("encode server message: %w", err)
	}
	return c.ws.Write(ctx, websocket.MessageText, payload)
}

func (c *conn) fail(code websocket.StatusCode, reason string) error {
	_ = c.ws.Close(code, reason)
	return fmt.Errorf("connection closed: %s", reason)
}

func identity(id uint64) room.ServerMsg {
	return room.ServerMsg{Identity: &id}
}

func sameCursor(a, b room.CursorData) bool {
	if len(a.Cursors) != len(b.Cursors) || len(a.Selections) != len(b.Selections) {
		return false
	}
	for i := range a.Cursors {
		if a.Cursors[i] != b.Cursors[i] {
			return false
		}
	}
	for i := range a.Selections {
		if a.Selections[i] != b.Selections[i] {
			return false
		}
	}
	return true
}

const writeTimeout = 10 * time.Second

// rateLimiter is a token bucket, refilled lazily on each check.
type rateLimiter struct {
	tokens   float64
	max      float64
	perSec   float64
	lastSeen time.Time
}

func newRateLimiter(perSec, burst float64) *rateLimiter {
	return &rateLimiter{tokens: burst, max: burst, perSec: perSec, lastSeen: time.Now()}
}

// allow is called only from the read goroutine, so it needs no lock.
func (l *rateLimiter) allow() bool {
	now := time.Now()
	l.tokens += now.Sub(l.lastSeen).Seconds() * l.perSec
	l.lastSeen = now
	if l.tokens > l.max {
		l.tokens = l.max
	}
	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}
