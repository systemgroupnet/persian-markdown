# Persian Markdown Editor — Implementation Plan

> A collaborative, RTL-first markdown editor. React + Plate frontend, Go backend with
> operational transformation, shipped as a single binary. MIT, by
> [systemgroupnet](https://github.com/systemgroupnet).

---

## 1. Decisions locked in

| Area | Decision |
|---|---|
| Source of truth | One plain-text markdown string per room. OT runs on that string, Rustpad-style. |
| WYSIWYG | [Plate](https://platejs.org) (Slate-based, React-native, ships shadcn components) |
| Collaboration | Custom OT engine in Go, ported from `operational-transform` / `ot.js` |
| Persistence | Rooms in memory; debounced snapshots to SQLite; restore on first join |
| Packaging | Single Go binary, frontend embedded via `go:embed`, one port |
| UI language | Bilingual FA/EN, Persian default, `dir` flips with locale |
| Markdown | CommonMark + GFM + syntax highlighting + KaTeX + Mermaid |
| Radius | `--radius: 2px` uniformly (Zed-style), nothing larger |
| Presence | Chrome is 100% grayscale; the *only* color in the app is remote cursors |
| Auth | None. No accounts, no login. Anonymous Persian animal names. |
| Text unit | **UTF-8 bytes**, end to end (§3.2) |
| Room IDs | 10-char nanoid, URL-safe alphabet, minted client-side |
| Room model | One local-only **private** document + unlimited shared rooms (§4.6) |
| Undo | Native editor history, remote ops excluded from the stack (§5.8) |

### Non-goals

Accounts, permissions, comments, version history UI, image upload, offline-first,
multi-replica horizontal scaling.

---

## 2. Architecture

```
                    ┌──────────────── browser ────────────────┐
                    │                                          │
   source view  ────┤ CodeMirror 6 ──┐                         │
   (markdown)       │                │                         │
                    │                ├──► markdown string ◄────┤ OT client
   split view   ────┤ CM6 + preview ─┤    (single truth)       │ (ot.js state
                    │                │                         │  machine)
   wysiwyg view ────┤ Plate/Slate ───┘                         │
                    │      ▲  serialize + diff                 │
                    └──────┼───────────────────────────────────┘
                           │              │ ws: {Edit, ClientInfo, CursorData}
                           │              ▼
                    ┌──────┴──────────────────────────────────┐
                    │ Go server                                │
                    │  room registry ─► Room{text, ops[], …}   │
                    │        │                                 │
                    │        ├─► internal/ot (transform/apply) │
                    │        └─► debounced snapshot ─► SQLite  │
                    │  go:embed web/dist  •  /assets/fonts     │
                    └──────────────────────────────────────────┘
```

Every view mode is a **projection of the same markdown string**. A view's job is to
turn local user intent into an OT operation over that string, and to apply incoming
operations back into itself. Nothing else in the system knows about Slate trees or
CodeMirror state.

### Repository layout

```
persian-markdown/
├── cmd/pmd/main.go               # flags, wiring, graceful shutdown
├── internal/
│   ├── ot/                       # the OT engine — the crown jewels
│   │   ├── op.go                 # OpSeq builder: Retain/Insert/Delete
│   │   ├── apply.go compose.go transform.go invert.go
│   │   ├── cursor.go             # TransformIndex for cursors/selections
│   │   └── (no encoding shim needed — Go strings are already UTF-8)
│   │   └── *_test.go  fuzz_test.go
│   ├── room/
│   │   ├── room.go               # per-document state machine
│   │   ├── registry.go           # id → *Room, expiry sweeper
│   │   ├── protocol.go           # ClientMsg / ServerMsg wire types
│   │   └── broadcast.go          # fan-out primitive
│   ├── store/sqlite.go           # snapshot + restore
│   ├── names/names.go            # Persian animal names
│   └── server/                   # http mux, ws upgrade, embed, limits
├── web/
│   ├── src/
│   │   ├── ot/                   # TS OT engine, mirrors internal/ot
│   │   ├── collab/               # useRoom, client state machine, presence
│   │   ├── views/{source,split,wysiwyg}/
│   │   ├── bridge/               # view ↔ markdown diff adapters
│   │   ├── markdown/             # render pipeline + HTML export
│   │   ├── components/ui/        # shadcn (vendored)
│   │   └── i18n/{fa,en}.ts
│   ├── public/assets/fonts/      # Vazirmatn woff2 (committed)
│   └── dist/                     # embedded into the binary
├── scripts/fetch-fonts.sh
├── testdata/ot-vectors.json      # shared Go ↔ TS golden vectors
├── Dockerfile  Makefile  LICENSE  README.md
```

---

## 3. The OT engine

### 3.1 Model

Identical in shape to `operational-transform`, which Rustpad uses. An operation is a
sequence of three component types applied left-to-right against a base document:

```go
type OpSeq struct {
    ops       []Op // Retain(n) | Insert(s) | Delete(n)
    baseLen   int  // length of doc this applies to
    targetLen int  // length of doc it produces
}
```

Wire encoding matches ot.js so the TS and Go engines share golden vectors:
positive int = retain, negative int = delete, string = insert.

```
"# سلام" ──[3, " دنیا", -1]──► "# سلدنیام"   (retain 3, insert, delete 1)
```

Required operations, in dependency order:

1. `Apply(doc string) (string, error)` — the definition of correctness.
2. `Compose(a, b)` — `apply(apply(d,a),b) == apply(d, compose(a,b))`.
3. `Transform(a, b) (a', b')` — TP1: `compose(a,b') == compose(b,a')`.
4. `Invert(doc)` — needed for undo.
5. `TransformIndex(pos int) int` — moves a cursor across an operation.

### 3.2 The unit problem — read this before writing any code

Offsets in an operation have to mean the same thing on both ends. Nobody agrees:

| Surface | Native unit |
|---|---|
| CodeMirror 6 offsets, Slate `Point.offset`, `selectionStart` | UTF-16 code units |
| Go `string`, `len(s)`, `s[i:j]` | UTF-8 bytes |
| Rustpad's wire format | Unicode scalar values |

**Decision: the protocol unit is the UTF-8 byte, everywhere.** The Go engine then
does no encoding work at all — `OpSeq` slices `string` directly and `len()` means
what it says. Conversion happens on the client, which is where the mismatch actually
originates.

This is a deliberate divergence from my first draft, and Rustpad is the evidence for
it. Rustpad does *not* put UTF-16 on the wire; it uses scalar values, and converts
client-side on every keystroke — its own source comments call UTF-16 the *"evil
encoding-dependent JavaScript representation"*:

```ts
// rustpad/src/rustpad.ts — runs on every content change
const initialLength = unicodeLength(content.slice(0, rangeOffset));
```

That is an O(document) prefix slice per edit, in production, and it is fine in
practice. UTF-8 costs the client exactly what scalar values cost it, and buys a
server with no conversion layer.

We can also do better than that line. CM6 exposes `doc.lineAt(pos)`, so we keep a
**cumulative byte-length index per line**, invalidated only for lines a change
touches. Converting a UTF-16 offset to a byte offset becomes
`lineByteStart[n] + utf8Len(lineText.slice(0, col))` — O(line), not O(document).
`web/src/ot/offsets.ts` owns this and is the only place in the frontend allowed to
convert between the two.

Invariants to test explicitly:

- **An operation must never split a multi-byte sequence.** `Apply` runs
  `utf8.Valid` on its result and rejects the operation if it fails, forcing the
  client to resync rather than propagating mojibake. Dev builds assert at the
  boundary instead. This replaces UTF-16's surrogate-pair hazard with a cheaper,
  more detectable one — invalid UTF-8 is trivially recognizable, a lone surrogate is
  not.
- **U+200C ZWNJ (نیم‌فاصله) must survive round-tripping untouched.** It appears inside
  ordinary Persian words (`می‌روم`), is 3 bytes in UTF-8, and a naive byte-offset bug
  will silently corrupt it. This is the single most likely way to break Persian text.
- Persian and Hebrew characters are 2 bytes; ZWNJ and most punctuation are 3. Byte
  offsets and character counts diverge constantly for our primary content — there is
  no ASCII happy path that would hide a conversion bug during development. Good.

Test corpus for every OT test, Go and TS: `"سلام دنیا"`, `"می‌روم"` (ZWNJ),
`"a😀b"` (4-byte), `"नमस्ते"` (combining marks), `"מה שלומך"` (Hebrew),
`"مخلوط mixed متن"` (bidi), `""`.

### 3.3 Testing the engine

This is the one component where a subtle bug corrupts user documents silently, so it
gets disproportionate test effort:

- Table tests for each method against hand-computed expectations.
- Go native fuzzing (`FuzzTransform`, `FuzzCompose`): generate a random document and
  two random operations over it, assert TP1 convergence and length invariants.
- `testdata/ot-vectors.json`: ~200 generated `(doc, opA, opB) → (opA', opB', result)`
  vectors, checked in. Both the Go and the TypeScript engine run them in CI. This is
  what stops the two implementations from drifting apart.

---

## 4. Backend

### 4.1 Protocol

WebSocket at `/api/socket/{docId}`, JSON, externally-tagged enums (same shape as
Rustpad, minus its Monaco `Language` message — our documents are always markdown).

**Client → Server**

```jsonc
{"Edit": {"revision": 12, "operation": [5, "سلام", -3]}}
{"ClientInfo": {"name": "یوزپلنگ ایرانی", "hue": 214}}
{"CursorData": {"cursors": [17], "selections": [[3, 9]]}}
```

**Server → Client**

```jsonc
{"Identity": 7}
{"History": {"start": 0, "operations": [{"id": 3, "operation": [5, "سلام"]}]}}
{"UserInfo": {"id": 3, "info": {"name": "هدهد", "hue": 41}}}   // info: null ⇒ left
{"UserCursor": {"id": 3, "data": {"cursors": [17], "selections": []}}}
```

On connect the server sends `Identity`, then the full `History` from revision 0, then
current `UserInfo`/`UserCursor` for every peer. The client replays history to build
the document — no separate "here is the text" message, which keeps exactly one code
path for document construction.

`GET /api/text/{docId}` returns the plain document for stateless fetches (curl, the
export path, health checks).

### 4.2 Room state machine

```go
type Room struct {
    mu      sync.RWMutex
    text    string
    ops     []UserOperation      // full history; revision == len(ops)
    users   map[uint64]UserInfo
    cursors map[uint64]CursorData
    bcast   *broadcast
    dirty   bool
}
```

Edit handling mirrors Rustpad: reject if `revision > len(ops)`; otherwise transform
the incoming operation against every operation from `revision` onward, apply, append,
transform all stored cursors through it, mark dirty, broadcast.

Fan-out uses a close-and-replace channel rather than a per-client queue — the Go
equivalent of tokio's `Notify`, and it cannot leak or block a slow reader:

```go
type broadcast struct{ mu sync.Mutex; ch chan struct{} }
func (b *broadcast) wait() <-chan struct{} { b.mu.Lock(); defer b.mu.Unlock(); return b.ch }
func (b *broadcast) publish()              { b.mu.Lock(); close(b.ch); b.ch = make(chan struct{}); b.mu.Unlock() }
```

Each connection runs one goroutine that loops: send everything past my last-sent
revision, then `<-bcast.wait()`. One writer per socket, so no write mutex needed.

Library: `github.com/coder/websocket` (context-aware, single-writer discipline,
actively maintained).

### 4.3 Limits

Ported from Rustpad, all flag-configurable:

| Limit | Default |
|---|---|
| Document size | 256 KiB |
| Operations before snapshot-and-compact | 4096 |
| Idle room expiry | 24 h |
| Connections per IP | 20 |
| Edits per connection | token bucket, 30/s burst 100 |
| Max message size | 512 KiB |

### 4.4 Persistence

`modernc.org/sqlite` — pure Go, **no cgo**, which is what keeps `GOOS=windows`,
`GOOS=linux` and a scratch Docker image all buildable from one machine.

```sql
CREATE TABLE IF NOT EXISTS document (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
```

A per-room goroutine flushes at most every 2 s while dirty, plus once on
last-disconnect. On first join for an unknown id, the registry reads the row and
seeds `text` at revision 0. A sweeper drops rows untouched for longer than the
retention window (default 30 days, `--retention`).

### 4.5 Persian animal names

`internal/names` holds a curated list of ~150 Iranian animals — یوزپلنگ ایرانی،
گورخر ایرانی، سمندر لرستانی، هوبره، شوکا، پازن، کاراکال، سیاه‌گوش، خرس سیاه بلوچی،
فُک خزری، هدهد، درنا، چکاوک، شاهین، تشی، روباه شنی … A name is drawn per connection;
on collision within a room a Persian-digit suffix is appended (`هدهد ۲`). The hue is
`fnv32(name) % 360`, so the same animal is the same color for everyone in the room.

### 4.6 Room model: one private document, unlimited shared rooms

| | Private | Shared |
|---|---|---|
| Route | `/` | `/{nanoid}` |
| Storage | IndexedDB, this browser only | Server memory + SQLite |
| Network | **none** — no socket is ever opened | WebSocket |
| Access | nobody else, ever | anyone with the id |
| Presence | hidden entirely | animal names + cursors |

**Private is the default landing experience.** Opening the app with no id gives you a
persistent local scratchpad — it survives reloads, and its bytes never leave the
machine. There is exactly one; it is a scratchpad, not a filesystem.

The key design move is that private mode is **not a second code path**. The collab
layer talks to a `Transport` interface, and private mode injects a loopback:

```ts
interface Transport {
  send(msg: ClientMsg): void
  onMessage(cb: (msg: ServerMsg) => void): void
}
// WebSocketTransport  — real server
// LoopbackTransport   — acks every Edit immediately at revision+1, persists to
//                       IndexedDB (debounced 300 ms), never emits presence
```

So the OT client state machine, all three views, the diff bridge, undo, and export
are byte-for-byte the same in both modes, and every OT bug is reproducible offline.
It also means a shared room that loses its connection degrades into something very
close to private mode until it reconnects.

**Sharing is an explicit, irreversible-feeling action.** A `اشتراک‌گذاری / Share`
button mints `nanoid(10)` client-side, navigates to `/{id}`, and seeds the room with
the current text. The private document is left untouched — sharing *copies*, it does
not move. The dialog says plainly that anyone with the link can read and edit, since
there is no auth to fall back on.

Because ids are minted client-side, the server treats any well-formed id as a valid
empty room (exactly as Rustpad does — it is a namespace, not a registry). It
validates shape only: `^[A-Za-z0-9_-]{6,24}$`, rejecting anything else before
touching the registry.

**The private document must be unmistakable.** A persistent `محلی / Local` badge in
the header, no presence area at all, and no share URL in the address bar. The
failure mode to design against is someone typing something sensitive into what they
believe is private — so the badge states the guarantee, rather than merely hinting
at it.

Ids are 10 chars from a 64-char alphabet (60 bits). Guessing an existing room is
infeasible, but this is *obscurity, not security*: room ids are unlisted and
unguessable, never secret. The About dialog and the share dialog both say so.

---

## 5. Frontend

### 5.1 Stack

Vite • React 19 • TypeScript • Tailwind v4 (CSS-first `@theme`, no config file) •
shadcn/ui • Plate • CodeMirror 6 • react-markdown.

### 5.2 The three views and the bridge

Every view implements one adapter interface:

```ts
interface ViewAdapter {
  applyRemote(op: OpSeq, newText: string): void  // remote change arrived
  // emits local ops via onLocalOp(op)
}
```

**Source view — CodeMirror 6.** `ViewUpdate.changes.iterChanges()` yields exact
(from, to, inserted) triples that map *directly* onto retain/delete/insert. No
diffing, no ambiguity — the only work is running the three offsets through
`offsets.ts` (§3.2), which is O(line) because `iterChanges` already tells us exactly
which lines were touched and therefore which index entries to invalidate. Remote ops
apply as a
`transaction` with `annotations: [remoteAnnotation]` so the change handler ignores
them. Remote cursors are drawn with a `StateField` of decorations.

CM6 is chosen over a bare `<textarea>` for one decisive reason:
**`EditorView.perLineTextDirection`** — a built-in facet that gives each line its own
auto-detected direction. In a mixed Persian/English markdown source that is the
difference between a readable document and a scrambled one.

**Split view.** CM6 on one side, the render pipeline on the other, with
percentage-based scroll sync (block-anchored, throttled with `requestAnimationFrame`,
and suppressed on the pane that isn't hovered to avoid feedback loops).

**WYSIWYG — Plate.** The hard one:

- *Entering the mode*: `editor.api.markdown.deserialize(text)`.
- *Local edit*: debounce 150 ms → `editor.api.markdown.serialize()` → diff against
  the last known markdown → emit an op. The diff is a common-prefix/common-suffix
  trim (O(n), and exactly right for the single-keystroke case that is 95% of edits),
  falling back to `diff-match-patch` when the trimmed region is large. Note this
  path needs **no offset conversion at all**: both sides are whole strings, so we
  encode each to `Uint8Array` once and diff in byte space directly, backing the trim
  boundaries off to a UTF-8 lead byte. UTF-8 is strictly simpler than UTF-16 here.
- *Remote edit*: apply to the markdown string, re-deserialize, and reconcile into
  Slate while preserving the local selection — by mapping the selection to a markdown
  offset, running it through `TransformIndex`, and mapping back. The offset↔node map
  is built from the `position` data remark attaches during deserialization.

### 5.3 Two real hazards in the WYSIWYG path

**Round-trip normalization.** `serialize(deserialize(md))` is not the identity for
all input. `_emphasis_` becomes `*emphasis*`, setext headings become ATX, reference
links get inlined, list markers normalize. If entering WYSIWYG mode silently
serializes, the first keystroke emits an operation that rewrites the entire document
and stomps on every collaborator's work.

Mitigation: on entering WYSIWYG, compute the round-trip and compare. If it differs,
do not emit anything — show a one-time bar: *«ورود به حالت ویرایش دیداری قالب‌بندی سند
را یکدست می‌کند»* with Normalize / Stay in source. The rewrite becomes an explicit,
attributable, single user action.

**Cursor jitter under concurrent editing.** Re-deserializing on every remote keystroke
will move the caret. Mitigation is staged (see M5): ship block-granular reconciliation
first — replace only the Slate blocks whose markdown source range actually changed,
leave the block containing the local caret alone until the user leaves it.

### 5.4 RTL

- Every block-level element rendered from markdown gets `dir="auto"` via a small
  rehype plugin. `dir="auto"` *is* the Unicode first-strong heuristic, implemented
  natively — so a Persian paragraph is RTL, an English one LTR, in the same document,
  with no JS.
- App shell direction follows the UI locale.
- All spacing uses Tailwind **logical** properties (`ps-`, `pe-`, `ms-`, `me-`,
  `start-`, `end-`, `text-start`) — never `pl-`/`pr-`/`left-`. One ESLint rule bans
  the physical ones so this cannot rot.
- Persian digits are a *presentation* concern: a `toFaDigits()` helper for UI counters
  and timestamps only. Document content is never transformed.
- Note for reviewers: in the source pane, an RTL line renders its `#` or `- ` marker
  on the visual right. That is correct bidi behavior, not a bug.

### 5.5 Design system

- One neutral OKLCH ramp, light and dark. Semantic tokens only (`--background`,
  `--foreground`, `--border`, `--muted`), no raw grays in components.
- `--radius: 2px`, applied uniformly. Avatars are 2px squares, not circles.
- Structure comes from 1px borders and dividers, not shadows or fills.
- **Icons: Lucide**, monochrome, `1.5px` stroke, sized on a 16/20px grid. No emoji
  anywhere, enforced by a lint rule over `src/**`.
- **On dashboardicons**: it is a library of ~1800 *service and brand logos*
  (Plex, Docker, Nextcloud). It has no bold/italic/list/undo/table glyphs, so it
  cannot furnish an editor toolbar. It is used in exactly one place — the
  systemgroupnet/GitHub mark in the About dialog. If a "simple" monochrome subset on
  the site turns out to cover UI glyphs after all, we can revisit; the toolbar is
  built against a thin `<Icon name>` wrapper so the source is swappable in one file.

### 5.6 Fonts

**Vazirmatn** (v33.003, SIL OFL) — the maintained successor to Vazir, by the same
author. `scripts/fetch-fonts.sh` downloads the release zip, extracts the variable
woff2 plus static 400/500/700, and writes them to `web/public/assets/fonts/`; the
files are committed so a clean clone builds offline and **nothing is ever fetched
from a CDN at runtime**.

```css
@font-face {
  font-family: "Vazirmatn";
  src: url("/assets/fonts/Vazirmatn[wght].woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}
```

The variable file is preloaded in `index.html`. Vazirmatn covers Latin as well, so one
family serves the whole UI. Code blocks use the system mono stack with Vazirmatn as
fallback (`ui-monospace, SFMono-Regular, Menlo, "Vazirmatn", monospace`) — Persian
inside a code fence still renders, and we ship zero extra font bytes.

### 5.7 Render pipeline

`remark-parse` → `remark-gfm` → `remark-math` → `remark-rehype` → `rehype-katex` →
`rehype-shiki` → `rehype-react`, plus the `dir="auto"` plugin and a mermaid block
handler.

KaTeX (~280 KB with fonts) and Mermaid (~1 MB) are **lazy-loaded via dynamic import,
triggered only when the document actually contains a math or mermaid node.** A plain
document never pays for them. KaTeX's fonts are self-hosted alongside Vazirmatn, same
rule as above.

### 5.8 Undo and history

Requirement was "undo like Rustpad". Worth stating what that is, because Rustpad has
no undo implementation — `grep -i "undo\|redo"` over `src/rustpad.ts` returns nothing.
Undo is whatever Monaco does by default, and Rustpad applies *remote* operations
through `model.pushEditOperations(...)`, which pushes them onto the local undo stack.
The consequence: in Rustpad, Ctrl+Z can revert a collaborator's typing. That is an
artifact of delegating to the editor, not a designed behavior.

We take the same architecture — native editor history, no OT undo stack — with one
one-line change that removes the footgun:

- **CodeMirror 6**: remote transactions are dispatched with
  `annotations: [Transaction.addToHistory.of(false)]`. Remote edits are applied but
  never enter your undo stack, so Ctrl+Z only ever reverts your own work.
- **Plate/Slate**: remote reconciliation runs inside `HistoryEditor.withoutSaving`,
  which is the same idea in Slate's vocabulary.

CM6 makes this strictly better than Monaco for free: **CM6's history maps its stored
changes through intervening changes**, including ones it didn't record. So after a
collaborator edits above your cursor, your undo still lands in the right place.
Monaco does not do this, which is the deeper reason Rustpad's undo feels unreliable.
This is a second, unplanned argument for the CM6 choice in §5.2.

Full OT undo — a local stack of inverted operations transformed against every remote
operation — is the principled version and is what `Invert` exists for in M1. It is
deliberately **not** in scope; the note is here so the option stays open rather than
being rediscovered later. Revisit only if the native stack proves confusing in real
multi-user sessions.

In private mode this all behaves identically, because there are no remote ops to
exclude.

---

## 6. Save and export

**Save as `.md`** — `showSaveFilePicker()` where available, `<a download>` fallback.
Filename seeds from the first H1, slugified, Persian characters preserved.

**Export HTML** — produced client-side, because the browser already holds the whole
pipeline plus rendered Mermaid SVG and KaTeX output; duplicating that in Go would mean
maintaining two renderers that must agree. Output is a **single self-contained file**:

- `<!doctype html><html lang="fa" dir="auto">`
- preview CSS inlined (extracted to a string at build time)
- Vazirmatn woff2 base64-inlined — a checkbox, default on, ~+95 KB
- Mermaid diagrams serialized as inline `<svg>`, KaTeX as its HTML + inlined fonts
- no scripts, no network requests — it opens correctly from a flash drive in 2035

---

## 7. About dialog

shadcn `Dialog`, 2px radius, monochrome. States: MIT-licensed open-source project by
[systemgroupnet](https://github.com/systemgroupnet), a link to the repository, build
version + commit injected via `-ldflags`, the Vazirmatn OFL attribution, and credit to
[Rustpad](https://github.com/ekzhang/rustpad) for the collaboration design. The GitHub
mark comes from dashboardicons.

---

## 8. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | Scaffold | `make build` emits one binary that serves the React app and Vazirmatn on `:3030`. CI green on lint + test. Docker image builds. |
| **M1** | Go OT core | Apply/Compose/Transform/Invert/TransformIndex pass table tests, fuzzing, and the shared vectors. UTF-8 / ZWNJ corpus green. |
| **M2** | Rooms & protocol | Two `wscat` clients converge. Presence, names, cursors, SQLite snapshot + restore across a restart. All limits enforced. |
| **M3** | Source view + private mode | TS OT client passes the same vectors. `LoopbackTransport` + IndexedDB gives a working private editor with **no server at all**. Then `WebSocketTransport`: CM6 with per-line direction, remote carets, reconnect with op replay, two browsers converging in one paragraph. |
| **M4** | Split view | Full render pipeline, scroll sync, lazy KaTeX/Mermaid, `dir="auto"` throughout. |
| **M5** | WYSIWYG | Plate round-trips a fixture corpus. Normalization prompt works. Block-granular reconciliation, then full cursor-preserving reconciliation. |
| **M6** | Export, About, i18n | Save `.md`, self-contained HTML export, About dialog, FA/EN toggle with shell direction flip. |
| **M7** | Polish | Keyboard shortcuts, a11y pass (focus order in RTL, screen reader labels), mobile layout, README, LICENSE, deploy docs. |
| **M8** | Landing site | Persian RTL site live on GitHub Pages, deployed by Actions, Lighthouse ≥ 95 across the board (§11). |

The `Transport` seam (§4.6) buys real sequencing freedom: M3's private half needs
only M1's shared vectors, not a running server, so the entire frontend — M3 private,
M4, M5, M6 — can be built and demoed against `LoopbackTransport` while M2 is still in
progress. M2 then lands as a transport swap rather than an integration.

---

## 9. Risks

| | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | WYSIWYG ↔ markdown ↔ OT reconciliation is the hardest part of the system | High | Staged in M5: block-granular first, full cursor preservation second. If full reconciliation proves unstable, the fallback is a soft single-writer lock in WYSIWYG mode — degrades one mode, breaks nothing. |
| R2 | UTF-16 → UTF-8 offset conversion on the client | High | `web/src/ot/offsets.ts` is the only converter, backed by a per-line byte index; `utf8.Valid` on the server rejects any operation that splits a sequence; ZWNJ corpus in every test, Go and TS. |
| R3 | Markdown round-trip normalization silently rewrites documents | High | Explicit normalization prompt on entering WYSIWYG (§5.3). Never emit an op the user did not ask for. |
| R4 | Plate API churn — the library moves fast | Medium | Pin exact versions; shadcn-style vendoring means the component code lives in our repo, so upgrades are opt-in. |
| R5 | Bundle weight from Mermaid + KaTeX | Medium | Dynamic import gated on document content; budget enforced in CI (initial JS ≤ 250 KB gzip). |
| R6 | dashboardicons cannot supply toolbar glyphs | Low | Lucide for chrome; single `<Icon>` indirection keeps the source swappable. |
| R7 | Unbounded op history in long-lived rooms | Low | Compact to a snapshot at 4096 ops, as Rustpad does. |

---

## 10. Open items to settle during M0

1. Whether to expose a read-only share mode (`?view=1`) — cheap to add, no auth
   needed: a client flag plus a server-side rejection of `Edit` on such connections.
2. Whether the private document should support more than one scratchpad. Starting at
   exactly one keeps the model honest ("the local one"); IndexedDB is keyed so that
   growing to many later is additive, not a migration.
3. Path routing (`/{id}`) vs. Rustpad's hash routing (`/#{id}`). Paths are cleaner
   and we control the server, but hash ids never reach the server in a request line,
   so they stay out of access logs and `Referer` headers. That is a small but real
   privacy argument for hashes given there is no auth. Leaning hash.

*Settled since the first draft:* room ids are `nanoid(10)` (§4.6), the text unit is
UTF-8 bytes (§3.2), undo uses the native editor history with remote ops excluded
(§5.8), and private mode is a loopback transport rather than a separate code path.

---

## 11. Landing site (GitHub Pages, Persian, RTL)

A separate static site in `site/`, served at
`systemgroupnet.github.io/persian-markdown`, deployed by GitHub Actions on push to
`main`.

**No build step.** Hand-written `index.html` + one stylesheet. A landing page is
three screens of static content; adding Vite to it would mean a second toolchain, a
second `node_modules`, and a build that can break independently of the app. Plain
files also mean the site keeps deploying even if the app's build is red.

```
site/
├── index.html          # lang="fa" dir="rtl"
├── styles.css          # design tokens duplicated deliberately (see below)
├── assets/
│   ├── fonts/          # symlink-free copy of Vazirmatn woff2, committed
│   ├── screenshot-light.webp  screenshot-dark.webp
│   └── og.png          # 1200×630 social card
└── CNAME               # only if a custom domain is added later
```

The tokens are **copied, not imported**, from the app's theme — about 20 lines of
CSS. Sharing them would couple a zero-dependency static page to a Tailwind v4 build
for no real gain; if the two drift by a few percent of gray, nothing breaks. This is
one of the few places where duplication is the cheaper answer, and it's noted here so
it reads as a decision rather than an oversight.

**Content, in order:** name and one-line description; a live screenshot of the editor
holding real Persian markdown; the four things that matter (بلادرنگ و بدون ثبت‌نام /
راست‌چین واقعی / سه حالت نمایش / خروجی MD و HTML); a `شروع کنید` button to the hosted
instance; a self-hosting block (`docker run -p 3030:3030 ghcr.io/systemgroupnet/…`);
and MIT + repository links.

**Constraints inherited from the app:** same monochrome palette, `--radius: 2px`,
Lucide icons inlined as SVG, no emoji, Vazirmatn self-hosted with a `preload` hint —
**no CDN, no Google Fonts, no analytics, no third-party requests at all.** The page
should make zero external connections; that is both a privacy position consistent
with a no-login product and the easiest way to hit the performance target.

**RTL specifics:** `dir="rtl"` on `<html>`, logical properties throughout
(`padding-inline`, `margin-inline-start`, `inset-inline-end`), and `dir="ltr"` set
explicitly on the code blocks — a `docker run` line inside an RTL page will otherwise
have its flags reordered on screen and become un-copyable. Screenshots need
`dir="ltr"` wrappers too so their captions don't mirror. An `<html lang="en" dir="ltr">`
English mirror at `/en/` is a stretch goal, sharing the stylesheet.

`.github/workflows/pages.yml` uploads `site/` with `actions/upload-pages-artifact`
and deploys with `actions/deploy-pages`. No secrets required.
