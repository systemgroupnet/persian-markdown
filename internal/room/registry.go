package room

import (
	"context"
	"log/slog"
	"regexp"
	"sync"
	"time"
)

// Store persists documents between server restarts.
//
// The interface is declared here, next to its consumer, so that the room
// package depends on nothing to be tested — the SQLite implementation lives in
// internal/store and is injected.
type Store interface {
	// Load returns the stored text for id. The boolean reports whether a
	// document existed at all, which is distinct from an empty one.
	Load(ctx context.Context, id string) (string, bool, error)
	Save(ctx context.Context, id, text string) error
	Delete(ctx context.Context, id string) error
}

// idPattern is the shape of a room id. Ids are minted by the client
// (nanoid(10)), so the server treats any well-formed id as a valid empty room —
// it is a namespace, not a registry of pre-created things. Validating the shape
// keeps the id safe to use as a database key and a log field.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,24}$`)

// ValidID reports whether an id is well formed.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// Config tunes a Registry.
type Config struct {
	MaxDocBytes      int           // per-document ceiling
	SnapshotInterval time.Duration // how often dirty rooms are written
	SweepInterval    time.Duration // how often idle rooms are collected
	Expiry           time.Duration // idle time before an empty room is dropped
}

func (c Config) withDefaults() Config {
	if c.MaxDocBytes <= 0 {
		c.MaxDocBytes = DefaultMaxDocBytes
	}
	if c.SnapshotInterval <= 0 {
		c.SnapshotInterval = 2 * time.Second
	}
	if c.SweepInterval <= 0 {
		c.SweepInterval = time.Minute
	}
	if c.Expiry <= 0 {
		c.Expiry = 24 * time.Hour
	}
	return c
}

// Registry owns the live rooms and the background work that keeps them tidy.
type Registry struct {
	cfg   Config
	store Store
	log   *slog.Logger

	mu    sync.Mutex
	rooms map[string]*Room
}

// NewRegistry creates a registry. store may be nil, in which case documents live
// only as long as the process — which is exactly what the tests want, and a
// legitimate deployment mode for an ephemeral instance.
func NewRegistry(store Store, cfg Config, log *slog.Logger) *Registry {
	if log == nil {
		log = slog.Default()
	}
	return &Registry{
		cfg:   cfg.withDefaults(),
		store: store,
		log:   log,
		rooms: make(map[string]*Room),
	}
}

// Get returns the room for id, restoring it from the store on first use.
func (g *Registry) Get(ctx context.Context, id string) (*Room, error) {
	g.mu.Lock()
	if r, ok := g.rooms[id]; ok {
		g.mu.Unlock()
		return r, nil
	}
	g.mu.Unlock()

	// Load outside the lock: a slow disk read must not stall every other room.
	var text string
	if g.store != nil {
		loaded, found, err := g.store.Load(ctx, id)
		if err != nil {
			return nil, err
		}
		if found {
			text = loaded
		}
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	// Someone may have created it while we were reading; theirs wins, so that
	// two simultaneous joiners can never end up with two different rooms.
	if r, ok := g.rooms[id]; ok {
		return r, nil
	}
	r := NewRoom(text, g.cfg.MaxDocBytes)
	g.rooms[id] = r
	return r, nil
}

// Count returns the number of live rooms.
func (g *Registry) Count() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.rooms)
}

// Run drives snapshotting and expiry until ctx is cancelled, then flushes once
// more so a clean shutdown does not lose the last few seconds of typing.
func (g *Registry) Run(ctx context.Context) {
	snapshot := time.NewTicker(g.cfg.SnapshotInterval)
	defer snapshot.Stop()
	sweep := time.NewTicker(g.cfg.SweepInterval)
	defer sweep.Stop()

	for {
		select {
		case <-ctx.Done():
			// Use a fresh context: ctx is already cancelled, and the final
			// flush is the most important write the process ever makes.
			flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			g.snapshotAll(flushCtx)
			cancel()
			return
		case <-snapshot.C:
			g.snapshotAll(ctx)
		case <-sweep.C:
			g.sweep(ctx)
		}
	}
}

func (g *Registry) snapshotAll(ctx context.Context) {
	if g.store == nil {
		return
	}
	for id, r := range g.list() {
		text, dirty := r.TakeDirty()
		if !dirty {
			continue
		}
		if err := g.store.Save(ctx, id, text); err != nil {
			g.log.Error("snapshot failed", "room", id, "err", err)
		}
	}
}

// sweep drops rooms that are empty and have been idle past the expiry. The
// document itself survives in the store; only the in-memory state is released,
// so rejoining an expired room restores it transparently.
func (g *Registry) sweep(ctx context.Context) {
	cutoff := time.Now().Add(-g.cfg.Expiry)

	for id, r := range g.list() {
		if !r.Empty() || r.IdleSince().After(cutoff) {
			continue
		}
		// Flush before dropping, otherwise the last edits before everyone left
		// would be lost.
		if text, dirty := r.TakeDirty(); dirty && g.store != nil {
			if err := g.store.Save(ctx, id, text); err != nil {
				g.log.Error("flush before sweep failed", "room", id, "err", err)
				continue
			}
		}

		g.mu.Lock()
		// Re-check under the lock: someone may have joined since we looked.
		if current, ok := g.rooms[id]; ok && current == r && r.Empty() {
			delete(g.rooms, id)
			g.log.Debug("room swept", "room", id)
		}
		g.mu.Unlock()
	}
}

func (g *Registry) list() map[string]*Room {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make(map[string]*Room, len(g.rooms))
	for k, v := range g.rooms {
		out[k] = v
	}
	return out
}
