# The installed Go toolchain is older than some upstream go.mod directives, and
# this machine cannot download toolchains. Pinning to `local` makes every target
# fail loudly on a real incompatibility instead of hanging on a download.
export GOTOOLCHAIN := local

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
LDFLAGS := -X main.version=$(VERSION) -X main.commit=$(COMMIT)

.PHONY: build test test-go test-web test-race vet fmt lint frontend clean run vectors

build: frontend
	go build -ldflags "$(LDFLAGS)" -o pmd ./cmd/pmd

# Backend only, using whatever is currently in web/dist.
build-server:
	go build -ldflags "$(LDFLAGS)" -o pmd ./cmd/pmd

# VITE_APP_* must be exported here, not only passed to the Go link step: the
# About dialog reads them from import.meta.env at frontend build time, so
# without this the UI reports version "dev" on a tagged release build.
frontend:
	cd web && pnpm install --frozen-lockfile && 		VITE_APP_VERSION=$(VERSION) VITE_APP_COMMIT=$(COMMIT) pnpm build

test: test-go test-web

test-go:
	go test ./... -count=1

test-web:
	cd web && pnpm exec tsc --noEmit && pnpm exec vitest run

# Regenerate the Go/TypeScript contract. A change here means a wire-format
# change: every client in the wild becomes incompatible, so review the diff.
vectors:
	go test ./internal/ot -run TestGoldenVectors -write-vectors
	cd web && pnpm exec vitest run src/ot/vectors.test.ts

# Needs a C toolchain, so it runs in CI (Linux) rather than on every desktop.
test-race:
	CGO_ENABLED=1 go test ./... -count=1 -race

fuzz:
	go test ./internal/ot -run=XXX -fuzz=FuzzTransform -fuzztime=60s

vet:
	go vet ./...

fmt:
	gofmt -l -w .

run: build-server
	./pmd -addr :3030 -log-level debug

clean:
	rm -f pmd pmd.exe *.db *.db-wal *.db-shm
	rm -rf web/dist/assets
