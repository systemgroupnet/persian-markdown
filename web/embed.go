// Package web carries the built frontend into the binary.
//
// The `all:` prefix matters: without it, embed skips files beginning with `_`
// or `.`, and Vite emits neither today but a future plugin might. Keeping the
// whole tree verbatim means what ships is exactly what was built.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the built frontend rooted at the directory the server serves
// from, so handlers deal in "index.html" rather than "dist/index.html".
func Dist() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
