package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func open(t *testing.T) *SQLite {
	t.Helper()
	// t.TempDir() is an absolute native path — on Windows it carries a drive
	// letter and backslashes, which is precisely the case that a naive
	// "file:"+path DSN gets wrong.
	db, err := OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "pmd.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSaveLoadRoundTrip(t *testing.T) {
	db := open(t)
	ctx := context.Background()

	if _, found, err := db.Load(ctx, "missing1"); err != nil || found {
		t.Fatalf("Load of absent document: found=%v err=%v", found, err)
	}

	const text = "# عنوان\n\nمتن با نیم‌فاصله: می‌روم 😀\n"
	if err := db.Save(ctx, "roomaa", text); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, found, err := db.Load(ctx, "roomaa")
	if err != nil || !found {
		t.Fatalf("Load: found=%v err=%v", found, err)
	}
	if got != text {
		t.Fatalf("round trip changed the document:\n got  %q\n want %q", got, text)
	}
}

func TestSaveOverwrites(t *testing.T) {
	db := open(t)
	ctx := context.Background()

	if err := db.Save(ctx, "roomaa", "اول"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := db.Save(ctx, "roomaa", "دوم"); err != nil {
		t.Fatalf("Save again: %v", err)
	}

	got, _, err := db.Load(ctx, "roomaa")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != "دوم" {
		t.Fatalf("text = %q, want %q", got, "دوم")
	}
}

func TestDeleteAndPurge(t *testing.T) {
	db := open(t)
	ctx := context.Background()

	if err := db.Save(ctx, "roomaa", "x"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := db.Delete(ctx, "roomaa"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, found, _ := db.Load(ctx, "roomaa"); found {
		t.Fatal("document survived Delete")
	}

	if err := db.Save(ctx, "roombb", "y"); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Nothing is older than an hour ago yet.
	if n, err := db.Purge(ctx, time.Now().Add(-time.Hour)); err != nil || n != 0 {
		t.Fatalf("premature purge: removed %d, err %v", n, err)
	}
	// Everything is older than an hour from now.
	if n, err := db.Purge(ctx, time.Now().Add(time.Hour)); err != nil || n != 1 {
		t.Fatalf("purge removed %d, want 1 (err %v)", n, err)
	}
	if _, found, _ := db.Load(ctx, "roombb"); found {
		t.Fatal("document survived Purge")
	}
}

func TestLargeDocumentRoundTrip(t *testing.T) {
	db := open(t)
	ctx := context.Background()

	// A full-size Persian document: 256 KiB of multi-byte text.
	text := strings.Repeat("سلام دنیا ", 26214)
	if err := db.Save(ctx, "roomaa", text); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, _, err := db.Load(ctx, "roomaa")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != text {
		t.Fatalf("large round trip mismatch: %d bytes in, %d out", len(text), len(got))
	}
}

func TestDSN(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"relative", "pmd.db", "file:pmd.db?" + pragmas},
		{"relative nested", filepath.Join("data", "pmd.db"), "file:data/pmd.db?" + pragmas},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := dsn(tc.in); got != tc.want {
				t.Fatalf("dsn(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}

	// Absolute paths differ per platform, so assert the shape rather than a
	// literal: a URI with an empty authority and forward slashes only.
	abs := dsn(filepath.Join(t.TempDir(), "pmd.db"))
	if !strings.HasPrefix(abs, "file:///") {
		t.Fatalf("absolute dsn %q should start with file:///", abs)
	}
	if strings.Contains(abs, `\`) {
		t.Fatalf("absolute dsn %q still contains backslashes", abs)
	}
}
