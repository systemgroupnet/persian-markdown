# ویرایشگر مارک‌داون فارسی (Persian Markdown Editor)

ویرایشگر مارک‌داون هم‌کارانه (collaborative)، راست‌چین‌محور (RTL-first) و بدون
نیاز به ثبت‌نام. یک فایند React با موتور Operational Transformation نوشته‌شده
در Go، همه در یک باینری واحد.

بدون حساب کاربری، بدون ورود. هر اتاق با یک شناسه‌ی تصادفی و حدس‌نزدنی شناخته
می‌شود؛ هر کسی که لینک را داشته باشد می‌تواند بخواند و ویرایش کند — یعنی این
شناسه‌ها **پنهان‌اند، نه محرمانه**. اگر به محرمانگی واقعی نیاز دارید، این ابزار
مناسب شما نیست.

## امکانات

- سه حالت نمایش روی یک منبع حقیقت مشترک: نمای منبع (CodeMirror 6)، نمای
  دوتکه (split، منبع + پیش‌نمایش)، و نمای WYSIWYG (مبتنی بر Plate/Slate).
- هم‌کاری بلادرنگ با موتور OT سفارشی نوشته‌شده در Go، الهام‌گرفته از
  `operational-transform` / `ot.js` و طراحی هم‌زمانی Rustpad.
- CommonMark + GFM، هایلایت کد، KaTeX برای فرمول‌های ریاضی، و Mermaid برای
  نمودارها.
- یک سند خصوصی محلی (فقط در مرورگر، بدون هیچ اتصال شبکه) به‌علاوه‌ی تعداد
  نامحدود اتاق‌های اشتراکی.
- بدون حساب کاربری. هویت هر کاربر یک نام حیوان ایرانی است (مثل «یوزپلنگ
  ایرانی» یا «هدهد») که هم‌زمان با هر اتصال به‌صورت تصادفی انتخاب می‌شود.
- پایداری با SQLite (نوشته‌شده به‌صورت خالص در Go، بدون cgo) — اسنپ‌شات‌های
  دوره‌ای و بازیابی سند در نخستین اتصال.
- یک باینری تکی: فرانت‌اند با `go:embed` در باینری Go جاسازی شده است؛ هیچ
  فایل استاتیک جداگانه‌ای برای سرو کردن وجود ندارد.
- طراحی دوزبانه (فارسی/انگلیسی)، فارسی پیش‌فرض، جهت متن (`dir`) هم‌زمان با
  زبان تغییر می‌کند.

## شروع سریع

### با Docker

```bash
docker run -p 3030:3030 -v pmd-data:/data ghcr.io/systemgroupnet/persian-markdown:latest
```

سپس مرورگر را در آدرس `http://localhost:3030` باز کنید. فلگ `-v pmd-data:/data`
یک ولوم برای پایگاه‌داده‌ی SQLite تعریف می‌کند تا اسناد بین ری‌استارت‌های
کانتینر باقی بمانند — ایمیج پیش‌فرض این مسیر را با `-db /data/pmd.db` می‌خواند.

ساخت ایمیج به‌صورت محلی:

```bash
docker build -t pmd .
docker run -p 3030:3030 -v pmd-data:/data pmd
```

### با Docker Compose

برای میزبانی دائمی، فایل `docker-compose.yml` آماده است:

```bash
docker compose up -d
```

این پیکربندی پورت را فقط روی `127.0.0.1` منتشر می‌کند، ولوم `pmd-data` را برای
پایگاه‌داده می‌سازد، و کانتینر را با فایل‌سیستم فقط‌خواندنی و بدون هیچ
capability اضافه اجرا می‌کند.

> **هشدار:** این سرویس هیچ ورود و احراز هویتی ندارد. اگر پورت را مستقیم روی
> اینترنت منتشر کنید، هرکس که شناسه‌ی یک اتاق را داشته باشد می‌تواند سند را
> بخواند و ویرایش کند. پیش از تغییر انتشار پورت، یک reverse proxy با TLS
> جلوی آن قرار دهید.

### ساخت از سورس (Source)

پیش‌نیازها: Go 1.22+، Node.js 20+، pnpm.

```bash
git clone https://github.com/systemgroupnet/persian-markdown
cd persian-markdown
make build   # فرانت‌اند را با pnpm می‌سازد و در باینری Go جاسازی می‌کند
./pmd
```

`make build` معادل اجرای دستی زیر است:

```bash
cd web && pnpm install --frozen-lockfile && pnpm build && cd ..
go build -ldflags "-X main.version=$(git describe --tags --always) -X main.commit=$(git rev-parse --short HEAD)" -o pmd ./cmd/pmd
```

> اگر روی ماشینی کار می‌کنید که Go نمی‌تواند toolchain جدیدتری دانلود کند،
> پیش از هر دستور Go مقدار `GOTOOLCHAIN=local` را export کنید.

### اجرای تست‌ها

```bash
make test       # هر دو مجموعه‌ی تست را اجرا می‌کند
make test-go     # go test ./...
make test-web    # tsc --noEmit + vitest، در مسیر web/
make test-race   # go test -race؛ نیازمند cgo، فقط در CI (لینوکس) اجرا می‌شود
```

موتور OT در Go و در TypeScript پیاده‌سازی مستقل دارند و باید همیشه هم‌راستا
بمانند؛ برای همین هر دو مجموعه‌ی تست، فایل مشترک `testdata/ot-vectors.json`
را می‌خوانند و روی همان بردارهای طلایی (golden vectors) اجرا می‌شوند — هرگونه
واگرایی بین دو پیاده‌سازی همان‌جا خودش را در CI نشان می‌دهد.

## پیکربندی

`pmd` با فلگ‌های خط فرمان پیکربندی می‌شود:

| فلگ | پیش‌فرض | توضیح |
|---|---|---|
| `-addr` | `:3030` | آدرسی که سرور روی آن گوش می‌دهد |
| `-db` | `pmd.db` | مسیر فایل SQLite؛ مقدار خالی پایداری را غیرفعال می‌کند |
| `-max-doc` | `262144` (۲۵۶ کیلوبایت) | حداکثر اندازه‌ی سند بر حسب بایت |
| `-expiry` | `24h` | زمان بی‌کاری پیش از خارج شدن یک اتاق خالی از حافظه |
| `-retention` | `720h` (۳۰ روز) | مدت نگه‌داری یک سند دست‌نخورده روی دیسک |
| `-snapshot-interval` | `2s` | فاصله‌ی نوشتن اسناد تغییریافته روی دیسک |
| `-max-conns-per-ip` | `20` | حداکثر اتصال هم‌زمان مجاز برای هر آدرس؛ `-1` این محدودیت را غیرفعال می‌کند |
| `-log-level` | `info` | یکی از `debug`، `info`، `warn` یا `error` |
| `-version` | `false` | چاپ نسخه و خروج |

## معماری، خلاصه

- **بک‌اند (Go):** یک موتور Operational Transformation سفارشی روی یک رشته‌ی
  متنی مارک‌داون در هر اتاق اجرا می‌شود (`internal/ot`)، اتاق‌ها را
  `internal/room` مدیریت می‌کند، و پایداری با SQLite خالص Go
  (`modernc.org/sqlite`, بدون cgo) در `internal/store` انجام می‌شود.
- **فرانت‌اند (React):** هر سه‌ی نمای منبع، دوتکه و WYSIWYG روی همان رشته‌ی
  مارک‌داون کار می‌کنند؛ کلاینت OT در TypeScript همان مدل موتور Go را دارد.
- **یک باینری واحد:** خروجی build فرانت‌اند (`web/dist`) با
  `//go:embed all:dist` (`web/embed.go`) در باینری Go جاسازی می‌شود — یک
  فایل اجرایی، یک پورت.
- **بدون حساب کاربری:** هیچ احراز هویتی وجود ندارد. شناسه‌ی اتاق‌ها
  (nanoid ده‌کاراکتری، حدس‌نزدنی) در سمت کلاینت ساخته می‌شود و به‌صورت
  خصوصی نیستند — فقط پنهان‌اند.

جزئیات کامل طراحی در [`PLAN.md`](./PLAN.md) آمده است.

## سپاسگزاری و مجوزها

طراحی لایه‌ی هم‌کاری (room registry، پروتکل WebSocket، مدل بازخوانی
تاریخچه) از [Rustpad](https://github.com/ekzhang/rustpad) الهام گرفته شده
است؛ سپاس از نویسنده و مشارکت‌کنندگان آن پروژه.

فونت [Vazirmatn](https://github.com/rastikerdar/vazirmatn) با مجوز
SIL Open Font License استفاده شده است.

این پروژه با مجوز MIT منتشر شده و توسط
[systemgroupnet](https://github.com/systemgroupnet) نگه‌داری می‌شود.

---

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
