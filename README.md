# Persian Markdown Editor

A collaborative, RTL-first markdown editor with no sign-up required. A React
frontend paired with an Operational Transformation engine written in Go,
shipped as a single binary.

There are no accounts and no login. Every room is identified by a random,
unguessable id; anyone holding the link can read and edit it — room ids are
**unlisted, not secret**. If you need real confidentiality, this is not the
right tool.

## Features

- Three views over one shared source of truth: source view (CodeMirror 6),
  split view (source + live preview), and a WYSIWYG view built on
  Plate/Slate.
- Real-time collaboration via a custom OT engine written in Go, modeled on
  `operational-transform` / `ot.js` and on Rustpad's concurrency design.
- CommonMark + GFM, code highlighting, KaTeX for math, and Mermaid for
  diagrams.
- One local-only private document (browser-only, no network connection at
  all) plus an unlimited number of shared rooms.
- No accounts. Each user's identity is a Persian animal name (e.g. "یوزپلنگ
  ایرانی", "هدهد") drawn at random per connection.
- Persistence via SQLite (pure Go, no cgo) — periodic snapshots, restored on
  first join.
- A single binary: the frontend is embedded into the Go binary with
  `go:embed`; there is no separate static file server to run.
- Bilingual (Persian/English) UI, Persian by default, with `dir` flipping
  alongside the active locale.

## Quickstart

### With Docker

```bash
docker run -p 3030:3030 -v pmd-data:/data ghcr.io/systemgroupnet/persian-markdown:latest
```

Then open `http://localhost:3030`. The `-v pmd-data:/data` volume gives the
SQLite database somewhere to persist across container restarts — the image's
default command already reads from `-db /data/pmd.db`.

Building the image locally:

```bash
docker build -t pmd .
docker run -p 3030:3030 -v pmd-data:/data pmd
```

### With Docker Compose

For a persistent deployment, `docker-compose.yml` is ready to use:

```bash
docker compose up -d
```

It publishes the port on `127.0.0.1` only, creates the `pmd-data` volume for
the database, and runs the container with a read-only root filesystem and all
capabilities dropped.

> **Warning:** this service has no login and no authentication. If you publish
> the port straight to the internet, anyone holding a room id can read and edit
> that document. Put a TLS-terminating reverse proxy in front before changing
> the port binding.

### Building from source

Prerequisites: Go 1.22+, Node.js 20+, pnpm.

```bash
git clone https://github.com/systemgroupnet/persian-markdown
cd persian-markdown
make build   # builds the frontend with pnpm, then embeds it into the Go binary
./pmd
```

`make build` is equivalent to running by hand:

```bash
cd web && pnpm install --frozen-lockfile && pnpm build && cd ..
go build -ldflags "-X main.version=$(git describe --tags --always) -X main.commit=$(git rev-parse --short HEAD)" -o pmd ./cmd/pmd
```

> If you're on a machine where Go cannot download a newer toolchain, export
> `GOTOOLCHAIN=local` before any Go command.

### Running the tests

```bash
make test       # runs both test suites
make test-go     # go test ./...
make test-web    # tsc --noEmit + vitest, inside web/
make test-race   # go test -race; needs cgo, CI (Linux) only
```

The OT engine has independent Go and TypeScript implementations that must
stay in lockstep; both test suites read the same
`testdata/ot-vectors.json` and replay it against the same golden vectors —
any drift between the two implementations shows up right there in CI.

## Configuration

`pmd` is configured with command-line flags:

| Flag | Default | Description |
|---|---|---|
| `-addr` | `:3030` | address to listen on |
| `-db` | `pmd.db` | SQLite database path; empty disables persistence |
| `-max-doc` | `262144` (256 KiB) | maximum document size in bytes |
| `-expiry` | `24h` | idle time before an empty room leaves memory |
| `-retention` | `720h` (30 days) | how long an untouched document is kept on disk |
| `-snapshot-interval` | `2s` | how often changed documents are written |
| `-max-conns-per-ip` | `20` | concurrent connections allowed per address; `-1` disables |
| `-log-level` | `info` | one of `debug`, `info`, `warn`, `error` |
| `-version` | `false` | print version and exit |

## Architecture, in brief

- **Backend (Go):** a custom Operational Transformation engine runs over one
  plain-text markdown string per room (`internal/ot`), rooms are managed by
  `internal/room`, and persistence uses pure-Go SQLite (`modernc.org/sqlite`,
  no cgo) in `internal/store`.
- **Frontend (React):** the source, split, and WYSIWYG views all operate on
  the same markdown string; the TypeScript OT client mirrors the Go engine's
  model.
- **Single binary:** the frontend build output (`web/dist`) is embedded into
  the Go binary with `//go:embed all:dist` (`web/embed.go`) — one executable,
  one port.
- **No accounts:** there is no authentication. Room ids (a 10-character
  nanoid, unguessable) are minted client-side and are not private — only
  unlisted.

Full design detail lives in [`PLAN.md`](./PLAN.md).

## Credits and licensing

The collaboration layer's design (room registry, WebSocket protocol, history
replay model) is based on [Rustpad](https://github.com/ekzhang/rustpad);
thanks to its author and contributors.

The [Vazirmatn](https://github.com/rastikerdar/vazirmatn) typeface is used
under the SIL Open Font License.

This project is released under the MIT License and maintained by
[systemgroupnet](https://github.com/systemgroupnet).
