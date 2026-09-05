package room

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/systemgroupnet/persian-markdown/internal/ot"
)

func op(build func(*ot.OpSeq)) *ot.OpSeq {
	o := ot.New()
	build(o)
	return o
}

func TestApplyEditAppendsAndUpdatesText(t *testing.T) {
	r := NewRoom("", 0)
	id, info := r.Join()

	if info.Name == "" {
		t.Fatal("join returned an empty name")
	}

	if err := r.ApplyEdit(id, 0, op(func(o *ot.OpSeq) { o.Insert("سلام") })); err != nil {
		t.Fatalf("ApplyEdit: %v", err)
	}
	if got := r.Text(); got != "سلام" {
		t.Fatalf("text = %q, want %q", got, "سلام")
	}
	if got := r.Revision(); got != 1 {
		t.Fatalf("revision = %d, want 1", got)
	}
}

// TestConcurrentEditsConverge is the room-level version of the OT property: two
// participants who both edited revision 0 must end up with one agreed document,
// and the second one must not need to know about the first.
func TestConcurrentEditsConverge(t *testing.T) {
	r := NewRoom("متن", 0) // 6 bytes, seeded as one synthetic operation
	// Seeded text is itself an operation, so the room opens at revision 1.
	base := r.Revision()
	a, _ := r.Join()
	b, _ := r.Join()

	// Both compose against the same revision, neither having seen the other.
	if err := r.ApplyEdit(a, base, op(func(o *ot.OpSeq) { o.Insert("الف "); o.Retain(6) })); err != nil {
		t.Fatalf("edit a: %v", err)
	}
	if err := r.ApplyEdit(b, base, op(func(o *ot.OpSeq) { o.Retain(6); o.Insert(" ب") })); err != nil {
		t.Fatalf("edit b: %v", err)
	}

	want := "الف متن ب"
	if got := r.Text(); got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if got := r.Revision(); got != base+2 {
		t.Fatalf("revision = %d, want %d", got, base+2)
	}

	// A participant replaying the log from scratch must reach the same text —
	// that is what makes History a sufficient join payload, and it only holds
	// because seeded text is recorded as an operation rather than smuggled in.
	_, history := r.HistorySince(0)
	replay := ""
	for _, h := range history {
		next, err := h.Operation.Apply(replay)
		if err != nil {
			t.Fatalf("replay: %v", err)
		}
		replay = next
	}
	if replay != want {
		t.Fatalf("replaying history gave %q, want %q", replay, want)
	}
}

func TestApplyEditRejectsFutureRevision(t *testing.T) {
	r := NewRoom("", 0)
	id, _ := r.Join()
	err := r.ApplyEdit(id, 5, op(func(o *ot.OpSeq) { o.Insert("x") }))
	if !errors.Is(err, ErrRevisionOutOfRange) {
		t.Fatalf("error = %v, want ErrRevisionOutOfRange", err)
	}
}

func TestApplyEditEnforcesSizeLimit(t *testing.T) {
	r := NewRoom("", 32)
	id, _ := r.Join()
	err := r.ApplyEdit(id, 0, op(func(o *ot.OpSeq) { o.Insert(strings.Repeat("a", 33)) }))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("error = %v, want ErrTooLarge", err)
	}
	if r.Text() != "" {
		t.Fatalf("rejected edit still changed the document to %q", r.Text())
	}
}

func TestCursorsFollowRemoteEdits(t *testing.T) {
	r := NewRoom("abcdef", 0)
	a, _ := r.Join()
	b, _ := r.Join()

	r.SetCursor(b, CursorData{Cursors: []int{4}, Selections: [][2]int{{4, 6}}})

	// a inserts two bytes at the start, so b's cursor must shift by two.
	if err := r.ApplyEdit(a, r.Revision(), op(func(o *ot.OpSeq) { o.Insert("XY"); o.Retain(6) })); err != nil {
		t.Fatalf("ApplyEdit: %v", err)
	}

	got := r.Cursors()[b]
	if len(got.Cursors) != 1 || got.Cursors[0] != 6 {
		t.Fatalf("cursor = %v, want [6]", got.Cursors)
	}
	if len(got.Selections) != 1 || got.Selections[0] != [2]int{6, 8} {
		t.Fatalf("selection = %v, want [[6 8]]", got.Selections)
	}
}

func TestSetCursorClampsOutOfRangePositions(t *testing.T) {
	r := NewRoom("abc", 0)
	id, _ := r.Join()
	r.SetCursor(id, CursorData{Cursors: []int{-5, 99}, Selections: [][2]int{{99, 1}}})

	got := r.Cursors()[id]
	if got.Cursors[0] != 0 || got.Cursors[1] != 3 {
		t.Fatalf("cursors = %v, want [0 3]", got.Cursors)
	}
	if got.Selections[0] != [2]int{1, 3} {
		t.Fatalf("selection = %v, want [1 3] (ordered and clamped)", got.Selections[0])
	}
}

func TestJoinGivesEveryoneADistinctName(t *testing.T) {
	r := NewRoom("", 0)
	seen := make(map[string]struct{})
	for i := 0; i < 40; i++ {
		_, info := r.Join()
		if _, dup := seen[info.Name]; dup {
			t.Fatalf("duplicate name %q in room after %d joins", info.Name, i)
		}
		seen[info.Name] = struct{}{}
	}
}

func TestConcurrentAccessIsRaceFree(t *testing.T) {
	// Meaningful under -race, which CI runs.
	r := NewRoom("", 0)
	var wg sync.WaitGroup

	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, _ := r.Join()
			for i := 0; i < 50; i++ {
				rev := r.Revision()
				_ = r.ApplyEdit(id, rev, op(func(o *ot.OpSeq) {
					o.Retain(len(r.Text()))
					o.Insert("ب")
				}))
				r.SetCursor(id, CursorData{Cursors: []int{0}})
				_ = r.Users()
				_, _ = r.HistorySince(0)
			}
			r.Leave(id)
		}()
	}
	wg.Wait()

	if !r.Empty() {
		t.Fatal("room should be empty after everyone left")
	}
	if r.Text() == "" {
		t.Fatal("expected at least some edits to have landed")
	}
}

func TestBroadcastWakesWaiters(t *testing.T) {
	r := NewRoom("", 0)
	ch := r.Changes()

	go func() {
		time.Sleep(10 * time.Millisecond)
		r.Join()
	}()

	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("waiter was not woken by a join")
	}
}

// --- registry -----------------------------------------------------------------

type fakeStore struct {
	mu   sync.Mutex
	docs map[string]string
	// saves counts writes so tests can assert the debounce actually debounces.
	saves int
}

func newFakeStore() *fakeStore { return &fakeStore{docs: make(map[string]string)} }

func (s *fakeStore) Load(_ context.Context, id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	text, ok := s.docs[id]
	return text, ok, nil
}

func (s *fakeStore) Save(_ context.Context, id, text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.docs[id] = text
	s.saves++
	return nil
}

func (s *fakeStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.docs, id)
	return nil
}

func TestValidID(t *testing.T) {
	good := []string{"abc123", "V1StGXR8_Z", "aaaaaaaaaa", strings.Repeat("x", 24)}
	for _, id := range good {
		if !ValidID(id) {
			t.Errorf("ValidID(%q) = false, want true", id)
		}
	}
	bad := []string{"", "short", "has space", "../etc/passwd", "درست", strings.Repeat("x", 25), "a/b"}
	for _, id := range bad {
		if ValidID(id) {
			t.Errorf("ValidID(%q) = true, want false", id)
		}
	}
}

func TestRegistryRestoresFromStore(t *testing.T) {
	store := newFakeStore()
	store.docs["abc123"] = "# سند ذخیره‌شده"

	g := NewRegistry(store, Config{}, nil)
	r, err := g.Get(context.Background(), "abc123")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := r.Text(); got != "# سند ذخیره‌شده" {
		t.Fatalf("restored text = %q", got)
	}

	// The same id must return the same live room, not a second copy.
	again, err := g.Get(context.Background(), "abc123")
	if err != nil {
		t.Fatalf("Get again: %v", err)
	}
	if again != r {
		t.Fatal("Get returned a different room instance for the same id")
	}
}

func TestRegistrySnapshotsAndSweeps(t *testing.T) {
	store := newFakeStore()
	g := NewRegistry(store, Config{
		SnapshotInterval: 10 * time.Millisecond,
		SweepInterval:    10 * time.Millisecond,
		Expiry:           20 * time.Millisecond,
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go g.Run(ctx)

	r, err := g.Get(ctx, "roomid")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	id, _ := r.Join()
	if err := r.ApplyEdit(id, 0, op(func(o *ot.OpSeq) { o.Insert("سلام") })); err != nil {
		t.Fatalf("ApplyEdit: %v", err)
	}
	r.Leave(id)

	// Wait for the snapshot, then for the sweep to release the empty room.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		saved := store.docs["roomid"]
		store.mu.Unlock()
		if saved == "سلام" && g.Count() == 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}

	store.mu.Lock()
	saved := store.docs["roomid"]
	store.mu.Unlock()
	t.Fatalf("timed out: stored text %q, live rooms %d", saved, g.Count())
}

func TestRegistrySnapshotSkipsCleanRooms(t *testing.T) {
	store := newFakeStore()
	g := NewRegistry(store, Config{}, nil)

	r, _ := g.Get(context.Background(), "roomid")
	id, _ := r.Join()
	_ = r.ApplyEdit(id, 0, op(func(o *ot.OpSeq) { o.Insert("x") }))

	g.snapshotAll(context.Background())
	g.snapshotAll(context.Background())
	g.snapshotAll(context.Background())

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.saves != 1 {
		t.Fatalf("store written %d times, want 1 — the dirty flag is not debouncing", store.saves)
	}
}
