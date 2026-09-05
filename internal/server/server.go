package server

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/systemgroupnet/persian-markdown/internal/room"
)

// Config tunes the HTTP server.
type Config struct {
	MaxConnsPerIP int     // 0 disables the limit
	EditsPerSec   float64 // token bucket refill
	EditBurst     float64 // token bucket size
}

func (c Config) withDefaults() Config {
	if c.MaxConnsPerIP == 0 {
		c.MaxConnsPerIP = 20
	}
	if c.EditsPerSec <= 0 {
		c.EditsPerSec = 30
	}
	if c.EditBurst <= 0 {
		c.EditBurst = 100
	}
	return c
}

// Server wires the registry to HTTP.
type Server struct {
	cfg    Config
	rooms  *room.Registry
	static fs.FS
	log    *slog.Logger

	mu    sync.Mutex
	perIP map[string]int
}

// New builds a Server. static is the built frontend, served for anything that
// is not an API route.
func New(rooms *room.Registry, static fs.FS, cfg Config, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg:    cfg.withDefaults(),
		rooms:  rooms,
		static: static,
		log:    log,
		perIP:  make(map[string]int),
	}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/text/{id}", s.handleText)
	mux.HandleFunc("GET /api/socket/{id}", s.handleSocket)
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// handleText serves the raw document, for curl, export tooling and health
// checks. It deliberately does not create a room that nobody has joined.
func (s *Server) handleText(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !room.ValidID(id) {
		http.Error(w, "invalid room id", http.StatusBadRequest)
		return
	}
	rm, err := s.rooms.Get(r.Context(), id)
	if err != nil {
		s.log.Error("load room", "room", id, "err", err)
		http.Error(w, "could not load document", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(rm.Text()))
}

func (s *Server) handleSocket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !room.ValidID(id) {
		http.Error(w, "invalid room id", http.StatusBadRequest)
		return
	}

	ip := clientIP(r)
	if !s.acquire(ip) {
		http.Error(w, "too many connections from this address", http.StatusTooManyRequests)
		return
	}
	defer s.release(ip)

	rm, err := s.rooms.Get(r.Context(), id)
	if err != nil {
		s.log.Error("load room", "room", id, "err", err)
		http.Error(w, "could not load document", http.StatusInternalServerError)
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Same-origin only. The frontend is served from this very binary, so
		// there is no legitimate cross-origin client, and allowing one would
		// let any page on the internet open sockets into users' rooms.
		OriginPatterns: nil,
	})
	if err != nil {
		s.log.Debug("websocket accept failed", "err", err)
		return
	}
	defer ws.CloseNow()

	ws.SetReadLimit(maxMessageBytes)

	userID, _ := rm.Join()
	defer rm.Leave(userID)

	c := &conn{
		ws:          ws,
		rm:          rm,
		id:          userID,
		log:         s.log.With("room", id, "user", userID),
		lim:         newRateLimiter(s.cfg.EditsPerSec, s.cfg.EditBurst),
		sentUsers:   make(map[uint64]room.UserInfo),
		sentCursors: make(map[uint64]room.CursorData),
	}

	err = c.run(r.Context())
	switch {
	case err == nil,
		errors.Is(err, context.Canceled),
		websocket.CloseStatus(err) == websocket.StatusNormalClosure,
		websocket.CloseStatus(err) == websocket.StatusGoingAway:
		// Ordinary disconnects.
	default:
		s.log.Debug("connection ended", "room", id, "user", userID, "err", err)
	}
}

// handleStatic serves the built SPA, falling back to index.html so that deep
// links like /aB3xK9zQ_p reach the client router instead of 404ing.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.static == nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}

	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}

	// Hashed build output must 404 when it is missing, never fall back to the
	// SPA shell. Serving index.html for a stale /assets/* request returns HTML
	// with a 200 that the browser then fails to parse as CSS or JS, which
	// surfaces as an inexplicable styling or runtime glitch instead of a clear
	// error. A real 404 lets the client recover, and makes a partial deploy
	// obvious rather than mysterious.
	isAsset := strings.HasPrefix(name, "assets/")

	f, err := s.static.Open(name)
	if err != nil {
		if isAsset {
			http.NotFound(w, r)
			return
		}
		s.serveIndex(w, r)
		return
	}
	defer f.Close()

	if info, err := f.Stat(); err != nil || info.IsDir() {
		if isAsset {
			http.NotFound(w, r)
			return
		}
		s.serveIndex(w, r)
		return
	}

	// Vite emits content-hashed filenames under /assets, so those are safe to
	// cache forever. Everything else, index.html above all, must not be.
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFileFS(w, r, s.static, name)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.static, "index.html")
}

func (s *Server) acquire(ip string) bool {
	if s.cfg.MaxConnsPerIP < 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.perIP[ip] >= s.cfg.MaxConnsPerIP {
		return false
	}
	s.perIP[ip]++
	return true
}

func (s *Server) release(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.perIP[ip] <= 1 {
		delete(s.perIP, ip)
		return
	}
	s.perIP[ip]--
}

// clientIP returns the address to count connections against.
//
// It reads the socket peer, never X-Forwarded-For: behind a proxy every client
// would otherwise be able to pick its own bucket by sending a header, which
// turns the limit into decoration. A deployment that terminates TLS elsewhere
// should set the limit on the proxy instead.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

const maxMessageBytes = 512 * 1024

// ListenAndServe runs the server until ctx is cancelled, then shuts down
// gracefully.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: it would cap the lifetime of every websocket.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}

	done := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		done <- err
	}()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
