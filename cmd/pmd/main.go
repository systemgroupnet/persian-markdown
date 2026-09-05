// Command pmd runs the Persian Markdown Editor: a collaborative RTL-first
// markdown editor served, frontend and all, from a single binary.
package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/systemgroupnet/persian-markdown/internal/room"
	"github.com/systemgroupnet/persian-markdown/internal/server"
	"github.com/systemgroupnet/persian-markdown/internal/store"
	"github.com/systemgroupnet/persian-markdown/web"
)

// Set with -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "pmd:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		addr          = flag.String("addr", ":3030", "address to listen on")
		dbPath        = flag.String("db", "pmd.db", "SQLite database path; empty disables persistence")
		maxDoc        = flag.Int("max-doc", room.DefaultMaxDocBytes, "maximum document size in bytes")
		expiry        = flag.Duration("expiry", 24*time.Hour, "idle time before an empty room leaves memory")
		retention     = flag.Duration("retention", 30*24*time.Hour, "how long an untouched document is kept on disk")
		snapshotEvery = flag.Duration("snapshot-interval", 2*time.Second, "how often changed documents are written")
		maxConnsPerIP = flag.Int("max-conns-per-ip", 20, "concurrent connections allowed per address; -1 disables")
		logLevel      = flag.String("log-level", "info", "debug, info, warn or error")
		showVersion   = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("pmd %s (%s)\n", version, commit)
		return nil
	}

	log := newLogger(*logLevel)
	slog.SetDefault(log)

	// Cancel on Ctrl-C so the registry gets to flush before we exit — the last
	// few seconds of someone's typing live only in memory until it does.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st room.Store
	if *dbPath != "" {
		sqlite, err := store.OpenSQLite(ctx, *dbPath)
		if err != nil {
			return err
		}
		defer sqlite.Close()

		if n, err := sqlite.Purge(ctx, time.Now().Add(-*retention)); err != nil {
			log.Warn("retention purge failed", "err", err)
		} else if n > 0 {
			log.Info("purged expired documents", "count", n)
		}
		st = sqlite
		log.Info("persistence enabled", "path", *dbPath, "retention", *retention)
	} else {
		log.Warn("persistence disabled: documents live only while the process does")
	}

	registry := room.NewRegistry(st, room.Config{
		MaxDocBytes:      *maxDoc,
		SnapshotInterval: *snapshotEvery,
		Expiry:           *expiry,
	}, log)

	registryDone := make(chan struct{})
	go func() {
		defer close(registryDone)
		registry.Run(ctx)
	}()

	static, err := frontend(log)
	if err != nil {
		return err
	}

	srv := server.New(registry, static, server.Config{
		MaxConnsPerIP: *maxConnsPerIP,
	}, log)

	log.Info("listening", "addr", *addr, "version", version)
	if err := srv.ListenAndServe(ctx, *addr); err != nil {
		return err
	}

	// Wait for the final snapshot flush before returning.
	<-registryDone
	log.Info("shutdown complete")
	return nil
}

// frontend returns the embedded build, or nil if the binary was compiled
// without one. A missing frontend is a warning rather than a fatal error so
// that `go run ./cmd/pmd` works for backend development before the first
// `pnpm build`.
func frontend(log *slog.Logger) (fs.FS, error) {
	dist, err := web.Dist()
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		log.Warn("no frontend build embedded; API routes only (run `pnpm build` in web/)")
		return nil, nil
	}
	return dist, nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	if err := l.UnmarshalText([]byte(level)); err != nil {
		l = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}
