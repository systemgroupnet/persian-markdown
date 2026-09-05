package room

import (
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/systemgroupnet/persian-markdown/internal/names"
	"github.com/systemgroupnet/persian-markdown/internal/ot"
)

var (
	// ErrRevisionOutOfRange means a client claimed a revision the room has
	// never reached. Either the client is broken or it is talking to a room
	// that was reset underneath it; both warrant a reconnect, not a retry.
	ErrRevisionOutOfRange = errors.New("room: revision out of range")
	// ErrTooLarge means the edit would push the document past the size limit.
	ErrTooLarge = errors.New("room: document size limit exceeded")
)

// DefaultMaxDocBytes matches Rustpad's 256 KiB ceiling. It is a byte count, so
// a Persian document holds roughly half the characters an English one does —
// still far more than anybody writes by hand in a collaborative scratchpad.
const DefaultMaxDocBytes = 256 * 1024

// Room is one collaborative document: the text, the operation log that produced
// it, and who is currently looking at it.
//
// Every exported method is safe for concurrent use. Reads take RLock, so the
// many socket goroutines fanning out state do not contend with each other; only
// an actual edit blocks them.
type Room struct {
	maxDoc int

	mu      sync.RWMutex
	text    string
	ops     []UserOperation
	users   map[uint64]UserInfo
	cursors map[uint64]CursorData
	nextID  uint64
	dirty   bool
	lastUse time.Time

	rngMu sync.Mutex
	rng   *rand.Rand

	bcast *broadcast
}

// SystemUserID owns operations the server synthesises rather than receives
// from a participant. Real participants are numbered from 1.
const SystemUserID uint64 = 0

// NewRoom creates a room seeded with text (empty for a fresh document).
//
// A seeded room gets a synthetic insert as its first operation, so that
// len(ops) and text always describe the same document. Clients reconstruct the
// document by replaying History from revision 0 — that is the single code path
// for building a document, and it is what makes joining and reconnecting
// identical. Storing restored text WITHOUT a matching operation would leave the
// room at revision 0 with non-empty text: every joiner would render an empty
// document, and their first edit would be rejected for a base-length mismatch.
func NewRoom(text string, maxDoc int) *Room {
	if maxDoc <= 0 {
		maxDoc = DefaultMaxDocBytes
	}

	r := &Room{
		maxDoc:  maxDoc,
		text:    text,
		users:   make(map[uint64]UserInfo),
		cursors: make(map[uint64]CursorData),
		nextID:  1,
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
		bcast:   newBroadcast(),
		lastUse: time.Now(),
	}

	if text != "" {
		seed := ot.New()
		seed.Insert(text)
		r.ops = append(r.ops, UserOperation{ID: SystemUserID, Operation: seed})
	}

	return r
}

// Text returns the current document.
func (r *Room) Text() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.text
}

// Revision returns the number of operations applied so far.
func (r *Room) Revision() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.ops)
}

// Empty reports whether nobody is connected.
func (r *Room) Empty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.users) == 0
}

// IdleSince returns when the room was last touched.
func (r *Room) IdleSince() time.Time {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.lastUse
}

// Changes returns the channel to wait on for the next update. Take it before
// reading state — see the broadcast documentation for why.
func (r *Room) Changes() <-chan struct{} { return r.bcast.wait() }

// Join allocates a participant id and a display name that is unique within the
// room, and returns the id along with the name.
func (r *Room) Join() (uint64, UserInfo) {
	r.mu.Lock()
	id := r.nextID
	r.nextID++

	taken := make(map[string]struct{}, len(r.users))
	for _, u := range r.users {
		taken[u.Name] = struct{}{}
	}
	r.mu.Unlock()

	r.rngMu.Lock()
	name := names.Unique(r.rng, taken)
	r.rngMu.Unlock()

	info := UserInfo{Name: name, Hue: names.Hue(name)}

	r.mu.Lock()
	r.users[id] = info
	r.lastUse = time.Now()
	r.mu.Unlock()

	r.bcast.publish()
	return id, info
}

// Leave removes a participant and their cursor.
func (r *Room) Leave(id uint64) {
	r.mu.Lock()
	delete(r.users, id)
	delete(r.cursors, id)
	r.lastUse = time.Now()
	r.mu.Unlock()
	r.bcast.publish()
}

// SetInfo updates a participant's display identity. Invalid names are ignored
// rather than rejected: a bad name is not worth dropping a connection over, and
// the participant keeps the one they were given at join.
func (r *Room) SetInfo(id uint64, info UserInfo) {
	if !names.Valid(info.Name) {
		return
	}
	info.Hue = names.Hue(info.Name)

	r.mu.Lock()
	if _, ok := r.users[id]; !ok {
		r.mu.Unlock()
		return
	}
	r.users[id] = info
	r.lastUse = time.Now()
	r.mu.Unlock()
	r.bcast.publish()
}

// SetCursor records where a participant is looking.
func (r *Room) SetCursor(id uint64, data CursorData) {
	r.mu.Lock()
	if _, ok := r.users[id]; !ok {
		r.mu.Unlock()
		return
	}
	r.cursors[id] = clampCursor(data, len(r.text))
	r.lastUse = time.Now()
	r.mu.Unlock()
	r.bcast.publish()
}

// ApplyEdit rebases an operation composed against the given revision onto the
// current document, applies it, and appends it to the log.
//
// This is the serialisation point of the whole system: the room's lock is what
// makes concurrent edits into a single agreed order, and the transform loop is
// what makes that order safe to impose on clients that did not know about it.
func (r *Room) ApplyEdit(userID uint64, revision int, op *ot.OpSeq) error {
	if op == nil {
		return fmt.Errorf("room: nil operation")
	}
	// Cheap rejection before doing any transform work.
	if op.TargetLen() > r.maxDoc {
		return ErrTooLarge
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if revision < 0 || revision > len(r.ops) {
		return fmt.Errorf("%w: client at %d, room at %d", ErrRevisionOutOfRange, revision, len(r.ops))
	}

	// Rebase across everything the client had not seen.
	transformed := op
	for _, other := range r.ops[revision:] {
		var err error
		transformed, _, err = ot.Transform(transformed, other.Operation)
		if err != nil {
			return fmt.Errorf("room: rebase: %w", err)
		}
	}

	if transformed.TargetLen() > r.maxDoc {
		return ErrTooLarge
	}

	newText, err := transformed.Apply(r.text)
	if err != nil {
		return fmt.Errorf("room: apply: %w", err)
	}

	r.text = newText
	r.ops = append(r.ops, UserOperation{ID: userID, Operation: transformed})

	// Drag everyone's caret along with the change. Without this, an edit above
	// someone's cursor leaves their remote caret rendered in the wrong place
	// for every other participant.
	for id, c := range r.cursors {
		r.cursors[id] = transformCursor(c, transformed)
	}

	r.dirty = true
	r.lastUse = time.Now()
	r.bcast.publish()
	return nil
}

// HistorySince returns the operations from revision onward.
func (r *Room) HistorySince(revision int) (int, []UserOperation) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if revision < 0 {
		revision = 0
	}
	if revision >= len(r.ops) {
		// An empty slice, never nil. encoding/json renders a nil slice as
		// `null`, and a client that strictly validates `operations` as an
		// array rejects the whole message — which for a brand-new room is the
		// *initial* History, so the session never establishes a baseline and
		// silently never becomes ready. Returning [] keeps the wire contract
		// "operations is always an array".
		return len(r.ops), []UserOperation{}
	}
	out := make([]UserOperation, len(r.ops)-revision)
	copy(out, r.ops[revision:])
	return revision, out
}

// Users returns a snapshot of current participants.
func (r *Room) Users() map[uint64]UserInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[uint64]UserInfo, len(r.users))
	for k, v := range r.users {
		out[k] = v
	}
	return out
}

// Cursors returns a snapshot of current cursor positions.
func (r *Room) Cursors() map[uint64]CursorData {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[uint64]CursorData, len(r.cursors))
	for k, v := range r.cursors {
		out[k] = v
	}
	return out
}

// TakeDirty reports whether the document changed since the last call and clears
// the flag, so the snapshot writer only writes when there is something to write.
func (r *Room) TakeDirty() (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.dirty {
		return "", false
	}
	r.dirty = false
	return r.text, true
}

func transformCursor(c CursorData, op *ot.OpSeq) CursorData {
	out := CursorData{
		Cursors:    make([]int, len(c.Cursors)),
		Selections: make([][2]int, len(c.Selections)),
	}
	for i, p := range c.Cursors {
		out.Cursors[i] = op.TransformIndex(p)
	}
	for i, s := range c.Selections {
		a, b := op.TransformRange(s[0], s[1])
		out.Selections[i] = [2]int{a, b}
	}
	return out
}

// clampCursor bounds client-supplied positions to the document.
//
// Cursor offsets arrive from the network and are echoed to every other
// participant, where they drive rendering. An out-of-range value is not
// dangerous on its own, but letting it persist means it gets transformed
// forever afterwards and never becomes valid again.
func clampCursor(c CursorData, length int) CursorData {
	const maxPositions = 64

	clamp := func(p int) int {
		if p < 0 {
			return 0
		}
		if p > length {
			return length
		}
		return p
	}

	if len(c.Cursors) > maxPositions {
		c.Cursors = c.Cursors[:maxPositions]
	}
	if len(c.Selections) > maxPositions {
		c.Selections = c.Selections[:maxPositions]
	}

	out := CursorData{
		Cursors:    make([]int, 0, len(c.Cursors)),
		Selections: make([][2]int, 0, len(c.Selections)),
	}
	for _, p := range c.Cursors {
		out.Cursors = append(out.Cursors, clamp(p))
	}
	for _, s := range c.Selections {
		a, b := clamp(s[0]), clamp(s[1])
		if a > b {
			a, b = b, a
		}
		out.Selections = append(out.Selections, [2]int{a, b})
	}
	return out
}
