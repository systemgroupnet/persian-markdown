package server

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/systemgroupnet/persian-markdown/internal/ot"
	"github.com/systemgroupnet/persian-markdown/internal/room"
	"github.com/systemgroupnet/persian-markdown/internal/store"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	registry := room.NewRegistry(nil, room.Config{}, discardLogger())
	srv := httptest.NewServer(New(registry, nil, Config{}, discardLogger()).Handler())
	t.Cleanup(srv.Close)
	return srv
}

// testClient is a minimal peer: it replays the history the server sends and
// keeps no local OT state, which is exactly what the real client does on join.
type testClient struct {
	t   *testing.T
	ws  *websocket.Conn
	id  uint64
	doc string
	rev int
}

func dial(t *testing.T, srv *httptest.Server, roomID string) *testClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/socket/" + roomID
	ws, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", url, err)
	}
	t.Cleanup(func() { _ = ws.CloseNow() })

	c := &testClient{t: t, ws: ws}

	// The server always leads with Identity.
	msg := c.read()
	if msg.Identity == nil {
		t.Fatalf("first message was not Identity: %+v", msg)
	}
	c.id = *msg.Identity
	return c
}

func (c *testClient) read() room.ServerMsg {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var msg room.ServerMsg
	if err := wsjson.Read(ctx, c.ws, &msg); err != nil {
		c.t.Fatalf("read: %v", err)
	}
	return msg
}

func (c *testClient) send(msg room.ClientMsg) {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, c.ws, msg); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

func (c *testClient) edit(revision int, build func(*ot.OpSeq)) {
	o := ot.New()
	build(o)
	c.send(room.ClientMsg{Edit: &room.EditMsg{Revision: revision, Operation: o}})
}

// applyUntil reads until the client has replayed want operations.
func (c *testClient) applyUntil(want int) {
	c.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for c.rev < want {
		if time.Now().After(deadline) {
			c.t.Fatalf("client %d stuck at revision %d, wanted %d", c.id, c.rev, want)
		}
		msg := c.read()
		if msg.History == nil {
			continue
		}
		if msg.History.Start != c.rev {
			c.t.Fatalf("history gap: got start %d, client at %d", msg.History.Start, c.rev)
		}
		for _, h := range msg.History.Operations {
			next, err := h.Operation.Apply(c.doc)
			if err != nil {
				c.t.Fatalf("apply history op: %v", err)
			}
			c.doc = next
			c.rev++
		}
	}
}

func serverText(t *testing.T, srv *httptest.Server, roomID string) string {
	t.Helper()
	resp, err := http.Get(srv.URL + "/api/text/" + roomID)
	if err != nil {
		t.Fatalf("GET text: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(body)
}

// TestTwoClientsConverge is the whole product in one test: two people type into
// the same paragraph at the same time, neither having seen the other's edit,
// and everybody ends up with identical bytes.
func TestTwoClientsConverge(t *testing.T) {
	srv := newTestServer(t)
	const id = "roomab"

	a := dial(t, srv, id)
	b := dial(t, srv, id)

	// Both compose against revision 0 — genuine concurrency, not a sequence.
	a.edit(0, func(o *ot.OpSeq) { o.Insert("سلام") })
	b.edit(0, func(o *ot.OpSeq) { o.Insert("درود") })

	a.applyUntil(2)
	b.applyUntil(2)

	if a.doc != b.doc {
		t.Fatalf("clients diverged:\n a = %q\n b = %q", a.doc, b.doc)
	}
	if got := serverText(t, srv, id); got != a.doc {
		t.Fatalf("server text %q disagrees with clients %q", got, a.doc)
	}
	// Whichever order the server picked, both edits must survive intact.
	if !strings.Contains(a.doc, "سلام") || !strings.Contains(a.doc, "درود") {
		t.Fatalf("an edit was lost: %q", a.doc)
	}
}

func TestClientsSeeEachOther(t *testing.T) {
	srv := newTestServer(t)
	const id = "roomcd"

	a := dial(t, srv, id)
	_ = dial(t, srv, id)

	// a must eventually be told about both participants, with Persian names.
	seen := make(map[uint64]room.UserInfo)
	deadline := time.Now().Add(5 * time.Second)
	for len(seen) < 2 && time.Now().Before(deadline) {
		msg := a.read()
		if msg.UserInfo != nil && msg.UserInfo.Info != nil {
			seen[msg.UserInfo.ID] = *msg.UserInfo.Info
		}
	}

	if len(seen) < 2 {
		t.Fatalf("only saw %d participants, want 2", len(seen))
	}
	names := make(map[string]struct{})
	for id, info := range seen {
		if info.Name == "" {
			t.Fatalf("participant %d has no name", id)
		}
		if info.Hue < 0 || info.Hue >= 360 {
			t.Fatalf("participant %d has hue %d outside [0,360)", id, info.Hue)
		}
		names[info.Name] = struct{}{}
	}
	if len(names) != 2 {
		t.Fatalf("participants share a name: %v", seen)
	}
}

func TestCursorsPropagate(t *testing.T) {
	srv := newTestServer(t)
	const id = "roomef"

	a := dial(t, srv, id)
	b := dial(t, srv, id)

	a.edit(0, func(o *ot.OpSeq) { o.Insert("abcdef") })
	a.applyUntil(1)
	b.applyUntil(1)

	b.send(room.ClientMsg{CursorData: &room.CursorData{Cursors: []int{4}}})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		msg := a.read()
		if msg.UserCursor == nil || msg.UserCursor.ID != b.id {
			continue
		}
		if got := msg.UserCursor.Data.Cursors; len(got) == 1 && got[0] == 4 {
			return
		}
		t.Fatalf("unexpected cursor payload: %+v", msg.UserCursor.Data)
	}
	t.Fatal("never received b's cursor")
}

func TestRejectsInvalidRoomID(t *testing.T) {
	srv := newTestServer(t)

	for _, id := range []string{"short", "has%20space", "wayTooLongToBeARealRoomIdentifier"} {
		resp, err := http.Get(srv.URL + "/api/text/" + id)
		if err != nil {
			t.Fatalf("GET: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("id %q: status %d, want 400", id, resp.StatusCode)
		}
	}
}

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	resp, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatalf("GET health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}
}

func TestRoomsAreIsolated(t *testing.T) {
	srv := newTestServer(t)

	a := dial(t, srv, "roomaa")
	b := dial(t, srv, "roombb")

	a.edit(0, func(o *ot.OpSeq) { o.Insert("محرمانه") })
	a.applyUntil(1)

	if got := serverText(t, srv, "roombb"); got != "" {
		t.Fatalf("edit leaked into another room: %q", got)
	}
	_ = b
}

// TestDocumentSurvivesRestart exercises the whole persistence path with the
// real SQLite store: edit, shut the server down, bring a new one up against the
// same file, and find the document waiting.
func TestDocumentSurvivesRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "pmd.db")
	const id = "roompersist"
	const want = "# سند ماندگار\n\nمی‌روم 😀"

	// --- first run ---
	{
		db, err := store.OpenSQLite(context.Background(), dbPath)
		if err != nil {
			t.Fatalf("open store: %v", err)
		}

		registry := room.NewRegistry(db, room.Config{
			SnapshotInterval: 10 * time.Millisecond,
		}, discardLogger())

		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() { defer close(done); registry.Run(ctx) }()

		srv := httptest.NewServer(New(registry, nil, Config{}, discardLogger()).Handler())

		c := dial(t, srv, id)
		c.edit(0, func(o *ot.OpSeq) { o.Insert(want) })
		c.applyUntil(1)

		srv.Close()
		cancel() // triggers the final flush
		<-done
		if err := db.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	}

	// --- second run, same file, nothing shared in memory ---
	{
		db, err := store.OpenSQLite(context.Background(), dbPath)
		if err != nil {
			t.Fatalf("reopen store: %v", err)
		}
		defer db.Close()

		registry := room.NewRegistry(db, room.Config{}, discardLogger())
		srv := httptest.NewServer(New(registry, nil, Config{}, discardLogger()).Handler())
		defer srv.Close()

		if got := serverText(t, srv, id); got != want {
			t.Fatalf("after restart text = %q, want %q", got, want)
		}
	}
}

// TestRestoredRoomReplaysToClients covers the gap that
// TestDocumentSurvivesRestart missed: that test read /api/text, which returns
// Room.text directly, so it stayed green even while websocket clients — every
// real user — reconstructed an EMPTY document from an empty history.
//
// A client builds its document solely by replaying History, so a restored room
// must expose its seeded text as a real operation.
func TestRestoredRoomReplaysToClients(t *testing.T) {
	const id = "roomrestored"
	const want = "# سند بازیابی‌شده\n\nمی‌روم 😀"

	db, err := store.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "pmd.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer db.Close()

	// Seed the store directly: this is exactly the state left behind by a
	// previous process that snapshotted and exited.
	if err := db.Save(context.Background(), id, want); err != nil {
		t.Fatalf("seed store: %v", err)
	}

	registry := room.NewRegistry(db, room.Config{}, discardLogger())
	srv := httptest.NewServer(New(registry, nil, Config{}, discardLogger()).Handler())
	defer srv.Close()

	c := dial(t, srv, id)
	c.applyUntil(1)

	if c.doc != want {
		t.Fatalf("client replayed %q, want %q", c.doc, want)
	}
	if got := serverText(t, srv, id); got != c.doc {
		t.Fatalf("server text %q disagrees with the client's replay %q", got, c.doc)
	}

	// And the client must be able to edit on top of it: before the fix its
	// revision-0 view disagreed with the server's text length, so the very
	// first keystroke was rejected for a base-length mismatch.
	c.edit(c.rev, func(o *ot.OpSeq) { o.Retain(len(want)); o.Insert(" تازه") })
	c.applyUntil(2)

	if expected := want + " تازه"; c.doc != expected {
		t.Fatalf("after editing a restored room: %q, want %q", c.doc, expected)
	}
}

// TestNewRoomSendsInitialHistory pins the protocol guarantee the client relies
// on: History always arrives, even when there is nothing to replay, so a client
// can tell "synchronised at revision 0" apart from "not told yet".
func TestNewRoomSendsInitialHistory(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, "roomfresh")

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		msg := c.read()
		if msg.History != nil {
			if msg.History.Start != 0 {
				t.Fatalf("initial History.Start = %d, want 0", msg.History.Start)
			}
			return
		}
	}
	t.Fatal("a brand-new room never sent an initial History message")
}

// TestMissingAssetIs404NotTheSPAShell pins the distinction between a deep link
// and a stale build artifact. Deep links must reach the client router, but a
// missing /assets/* file must 404: returning index.html with a 200 gives the
// browser HTML where it expects CSS or JS, which manifests as an unexplainable
// rendering glitch rather than an error anyone can act on.
func TestMissingAssetIs404NotTheSPAShell(t *testing.T) {
	static := fstest.MapFS{
		"index.html":             &fstest.MapFile{Data: []byte("<!doctype html><title>app</title>")},
		"assets/index-abc123.js": &fstest.MapFile{Data: []byte("console.log(1)")},
	}
	registry := room.NewRegistry(nil, room.Config{}, discardLogger())
	srv := httptest.NewServer(New(registry, static, Config{}, discardLogger()).Handler())
	defer srv.Close()

	tests := []struct {
		name string
		path string
		want int
	}{
		{"existing asset", "/assets/index-abc123.js", http.StatusOK},
		{"stale asset", "/assets/index-stale999.js", http.StatusNotFound},
		{"stale stylesheet", "/assets/SplitView-gone.css", http.StatusNotFound},
		{"deep link reaches the router", "/V1StGXR8_Z", http.StatusOK},
		{"root", "/", http.StatusOK},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := http.Get(srv.URL + tc.path)
			if err != nil {
				t.Fatalf("GET %s: %v", tc.path, err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.want {
				t.Fatalf("GET %s = %d, want %d", tc.path, resp.StatusCode, tc.want)
			}
		})
	}
}
