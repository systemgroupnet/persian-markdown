// Package store persists documents between server restarts.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	// Pure-Go SQLite. The cgo-based driver would tie every build to a C
	// toolchain and make cross-compiling the single binary (PLAN.md §4.4) a
	// chore; this one keeps `GOOS=linux go build` working from any machine.
	_ "modernc.org/sqlite"
)

// SQLite stores one row per document.
type SQLite struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS document (
	id         TEXT PRIMARY KEY,
	text       TEXT NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS document_updated_at ON document(updated_at);
`

// pragmas are applied to every connection in the pool.
//
// WAL lets the snapshot writer commit without blocking readers restoring other
// rooms. busy_timeout turns the rare write collision into a short wait instead
// of an immediate "database is locked". synchronous=NORMAL is the right trade
// under WAL: a crash can cost the last commit, which for us means a couple of
// seconds of typing that the clients still hold anyway.
const pragmas = "_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"

// dsn builds a driver connection string for a filesystem path.
//
// Windows paths are the awkward case: `file:C:\dir\pmd.db` is not a valid URI —
// the backslashes are not separators and the drive colon reads as a scheme
// delimiter. Converting to forward slashes and giving absolute paths the empty
// authority produces `file:///C:/dir/pmd.db`, which SQLite accepts on every
// platform, and url.URL escapes any spaces in the path for us.
func dsn(path string) string {
	p := filepath.ToSlash(path)

	u := url.URL{Scheme: "file", RawQuery: pragmas}
	if filepath.IsAbs(path) {
		if !strings.HasPrefix(p, "/") {
			p = "/" + p // C:/dir/pmd.db -> /C:/dir/pmd.db
		}
		u.Path = p
	} else {
		// Relative paths must stay relative; a Path would gain a leading slash.
		u.Opaque = p
	}
	return u.String()
}

// OpenSQLite opens (and creates if needed) the database at path.
func OpenSQLite(ctx context.Context, path string) (*SQLite, error) {
	db, err := sql.Open("sqlite", dsn(path))
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Writes are rare (one debounced snapshot per dirty room every couple of
	// seconds) and SQLite serialises them anyway, so a small pool avoids
	// spurious "database is locked" contention for no throughput cost.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	if _, err := db.ExecContext(ctx, schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &SQLite{db: db}, nil
}

// Close releases the database.
func (s *SQLite) Close() error { return s.db.Close() }

// Load returns the stored text for id, and whether a row existed.
func (s *SQLite) Load(ctx context.Context, id string) (string, bool, error) {
	var text string
	err := s.db.QueryRowContext(ctx, `SELECT text FROM document WHERE id = ?`, id).Scan(&text)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", false, nil
	case err != nil:
		return "", false, fmt.Errorf("load document %q: %w", id, err)
	}
	return text, true, nil
}

// Save writes the document, replacing any previous version.
func (s *SQLite) Save(ctx context.Context, id, text string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO document (id, text, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
		id, text, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("save document %q: %w", id, err)
	}
	return nil
}

// Delete removes a document.
func (s *SQLite) Delete(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM document WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete document %q: %w", id, err)
	}
	return nil
}

// Purge removes documents untouched since cutoff and reports how many went.
//
// Rooms are unlisted and unguessable but never secret, and there is no account
// to attach a deletion request to — so a bounded retention window is the only
// data-lifecycle control the product has. It is worth keeping honest.
func (s *SQLite) Purge(ctx context.Context, cutoff time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM document WHERE updated_at < ?`, cutoff.Unix())
	if err != nil {
		return 0, fmt.Errorf("purge documents: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil // the delete succeeded; the count is not worth an error
	}
	return n, nil
}
