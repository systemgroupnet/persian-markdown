# syntax=docker/dockerfile:1
#
# Multi-stage build for pmd (Persian Markdown Editor): the frontend is built
# first, then embedded into the Go binary via `//go:embed all:dist`
# (web/embed.go), then the binary is copied alone into a minimal final image.
#
# Build:
#   docker build -t pmd .
#   docker build -t pmd --build-arg VERSION=$(git describe --tags --always) \
#                        --build-arg COMMIT=$(git rev-parse --short HEAD) .
# Run:
#   docker run -p 3030:3030 -v pmd-data:/data pmd

# ---------------------------------------------------------------------------
# Stage 1: build the React/Vite frontend (web/dist)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend

WORKDIR /app/web

# Install with a frozen lockfile before copying the rest of the source, so
# this layer is cached until package.json/pnpm-lock.yaml actually change.
COPY web/package.json web/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --frozen-lockfile

COPY web/ ./

# The same version metadata the Go link step stamps in, but the frontend needs
# it at ITS build time: the About dialog reads import.meta.env, so passing the
# values only to the Go stage leaves the UI reporting "dev" on a real release.
ARG VERSION=dev
ARG COMMIT=none
ENV VITE_APP_VERSION=${VERSION}
ENV VITE_APP_COMMIT=${COMMIT}

RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2: build the Go binary, embedding the frontend produced above
# ---------------------------------------------------------------------------
FROM golang:1.22-alpine AS backend

# This machine's dev toolchain cannot download a newer one (see go.mod's
# `go 1.22` directive and Makefile); pin the same behavior in CI/Docker so a
# stray toolchain bump fails the build loudly instead of silently fetching.
ENV GOTOOLCHAIN=local
# modernc.org/sqlite is pure Go (no cgo) precisely so this can be a static,
# CGO_ENABLED=0 build — keeps the final image minimal and portable.
ENV CGO_ENABLED=0

ARG VERSION=dev
ARG COMMIT=none

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Overlay the frontend build from stage 1 onto web/dist, which web/embed.go
# embeds with `//go:embed all:dist`.
COPY --from=frontend /app/web/dist ./web/dist
# Empty writable directory for the final stage's SQLite volume (see below);
# created here, as root, so it can be chowned to the nonroot user on copy.
RUN mkdir -p /data

RUN go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/pmd ./cmd/pmd

# ---------------------------------------------------------------------------
# Stage 3: minimal runtime image — just the static binary, no shell, no libc
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS final

# distroless static-debian12 has no shell and no package manager, which is
# exactly why it is the smallest and lowest-attack-surface base for a static
# CGO_ENABLED=0 binary. The ":nonroot" variant already runs as the built-in
# "nonroot" user (uid/gid 65532); we just need /data to be writable by it.
COPY --from=backend --chown=nonroot:nonroot /data /data
COPY --from=backend /out/pmd /pmd

# SQLite state (the -db file and its -wal/-shm siblings) must survive
# container restarts and recreations.
VOLUME ["/data"]

EXPOSE 3030

# No HEALTHCHECK: distroless/static has no shell and no curl/wget/nc binary
# to probe GET /api/health with, and HEALTHCHECK's exec form still needs some
# binary to run. Do liveness/readiness checks at the orchestrator level
# instead (e.g. a Kubernetes httpGet probe against /api/health, or a sidecar
# in Compose) — that's the only way to check this endpoint against this image.

ENTRYPOINT ["/pmd"]
CMD ["-addr", ":3030", "-db", "/data/pmd.db"]
