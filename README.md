# Expense Tracker

A minimal full-stack expense tracker built for correctness over feature breadth — idempotent writes, integer money, and deterministic list ordering.

**Live:** _deploy URL goes here_
**Stack:** Node + TypeScript + Fastify + SQLite (backend) · React + Vite + TanStack Query (frontend)

---

## Running locally

**Backend** (port 3000):
```bash
cd backend
npm install
npm run dev
```

**Frontend** (port 5173):
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/expenses` to the backend — no CORS config needed locally.

---

## Key design decisions

### Money is stored as integer paise

All amounts live in the database as `INTEGER` paise (₹1 = 100 paise). Floats are wrong for money: `0.1 + 0.2 === 0.30000000000000004` in IEEE 754. Summing 100 entries of ₹0.10 as floats gives `9.999999999999998`; in paise it's exactly `1000`.

The boundary rule: rupee strings come in from the form, get validated with `/^\d+(\.\d{1,2})?$/` and converted to integer paise at the API layer. They're converted back to rupees only at the render layer, via `Intl.NumberFormat`. The conversion helpers live in `src/lib/money.ts` on each side — not shared across the network boundary to avoid build coupling.

### Idempotency via `Idempotency-Key` header + UNIQUE constraint

The frontend generates a UUID v4 when the form mounts and sends it as `Idempotency-Key` on every `POST /expenses`. The same key persists across retries of the same submission attempt; a new key is generated only after a successful response.

The TEXT PRIMARY KEY constraint on idempotency_keys.key is what makes this contract safe at the schema level rather than the runtime level. Within a single better-sqlite3 process the writes are already serialized, so true concurrent inserts can't happen here — but if this ever moved to a multi-process or async driver, the safety guarantee doesn't change. The constraint is the contract; the application logic is just an optimization.

Double-submit has three layers: `disabled={mutation.isPending}` catches UI clicks during the request, the same key on retries handles network blips, and the UNIQUE constraint backstops the database.

### SQLite over Postgres

Zero ops: no connection pool, no separate process, no cloud database cost. The database is a single file on disk, which makes it trivial to inspect (`sqlite3 expenses.db`), back up (`cp`), and deploy (Render persistent disk). The trade-off is that SQLite doesn't scale past a single Node process — writes aren't concurrent. For a single-user expense tracker with no auth, that's not a real constraint.

WAL mode is enabled (`PRAGMA journal_mode = WAL`) so reads don't block writes. Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### Two prepared statements instead of `? IS NULL OR category = ?`

The first instinct for optional filtering is `WHERE (? IS NULL OR category = ?)` with a single prepared statement. It works, but SQLite's query planner sees the `? IS NULL` branch at prepare time and can't pick `idx_expenses_category` — `EXPLAIN QUERY PLAN` shows a full scan. Two statements (one for all expenses, one with `WHERE category = ?`) lets the planner pick the right index in each case. Verified with `EXPLAIN QUERY PLAN`: the filtered path uses `idx_expenses_category`, the unfiltered path uses `idx_expenses_date`.

### Same-date tiebreaker on `created_at DESC`

Without a tiebreaker, two expenses on the same date come back in whatever order SQLite's B-tree hands them out — non-deterministic across queries. The ORDER BY is `date DESC, created_at DESC`: newest date first, and within the same date, most recently created first. This is tested explicitly: insert two same-date expenses with known `created_at` values, assert the order.

### Local-date parsing for display

`new Date('2024-01-15')` parses the ISO string as UTC midnight, then `Intl.DateTimeFormat` renders it in the local timezone. In UTC−1, midnight UTC is 11 PM the previous day, so `2024-01-15` renders as `14 Jan`. The fix: parse as `new Date(year, month - 1, day)` (local midnight) before formatting. Small detail, wrong in every negative-offset timezone without it.

### Category filter uses two queries

The filter dropdown is populated from the distinct categories in the current data (`[...new Set(expenses.map(e => e.category))]`). If the dropdown used the filtered query, selecting "Food" would make "Transport" disappear from the dropdown — the user couldn't switch filters without clearing first. Two queries fix this: one unfiltered for the dropdown, one filtered for the table and total. TanStack Query caches both independently. The overhead is one extra request that hits the SQLite index; acceptable at this scale.

### Structured request logging

Fastify uses pino under the hood. The app is configured with `{ level: 'info', redact: ['req.headers.authorization'] }` — every request logs method, URL, status, and latency automatically. An `onRequest` hook additionally logs the `Idempotency-Key` header on POSTs so every create attempt is traceable by key in production logs.

### Real health check

`GET /health` runs `SELECT 1` against SQLite. If the DB is unreachable it returns `503 { status: "degraded", db: "error" }` rather than a misleading 200. Render's health probe will catch actual DB failures instead of just checking that the process is alive.

### Startup idempotency key sweep

On every deploy, the server runs `DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-7 days')`. Keys only need to survive the window during which clients retry — minutes to hours, never days. A background TTL cron job would be more precise, but a startup sweep is simpler and sufficient. The trade-off is keys created just before a deploy last slightly longer than 7 days; that's harmless.

### Request body limit

Fastify is configured with `bodyLimit: 10 * 1024` (10 KB). An expense description is bounded to 500 characters by the Zod schema, so 10 KB is generous headroom. This prevents a client from sending a multi-megabyte payload that buffers into memory before validation rejects it.

### Graceful shutdown

`process.on('SIGTERM')` and `process.on('SIGINT')` call `fastify.close()` then `db.close()`. This lets in-flight requests drain before the process exits and flushes any pending SQLite WAL writes. Without it, a `SIGTERM` from the container orchestrator kills the process mid-request.

---

## Trade-offs made because of timebox

- **Same key + different body returns the original response**, not 409. Stripe-style: the first request wins; subsequent requests with the same key get its response regardless of body. A strict implementation would hash the request body and return 409 on mismatch; that requires storing the hash and adds complexity not warranted here.

- **No frontend automated tests.** RTL + MSW would mostly verify that React Query is wired up correctly, not that the business logic is right. The correctness-critical code (money conversion, idempotency, filtering, sorting) is on the backend, which has 37 tests. The form's `validate()` function mirrors the backend Zod schema — that symmetry is manually verified, not tested.

- **Sort is static newest-first**, not a real toggle. Adding `date_asc` would need a backend route change, a new test, and a toggle button. The extra UI for ~1% of use cases isn't worth it on a timebox.

- **No dedicated `/expenses/categories` endpoint.** The two-query approach (unfiltered for dropdown, filtered for table) makes two requests instead of one targeted one. At scale this is the wrong direction; here it's the simplest code that works correctly.

- **No dark mode, no animations beyond loading skeleton, no icons.** Styling time went into spacing rhythm, tabular-numeral alignment, and consistent 4px-base spacing rather than visual decoration.

---

## Intentionally not done

- **No authentication, no per-user data.** Single-user tool as scoped by the brief.
- **No edit or delete.** Adding update needs soft-delete if history matters, which means more schema and tests. Out of scope.
- **No pagination.** A single `SELECT` over ~1000 rows is fast in SQLite. Past that, add `?cursor` with a stable sort key.
- **No background cleanup of `idempotency_keys`** beyond the startup sweep. In production a scheduled job expiring keys older than 24h would be more precise. The startup sweep is simpler and sufficient for this scale.

---

## Edge cases handled

- **Triple-click on submit** — button disabled after first click; same idempotency key on any that slip through; UNIQUE constraint backstops the database.
- **Backend down** — error banner with Retry button; form keeps user input (form is never cleared before `onSuccess`).
- **Network drops mid-submit** — user retries with the same key; if the request reached the server and succeeded, the backend returns the original response. The user doesn't create a duplicate.
- **Page refresh after submit** — if the request succeeded, the row is in the database. On reload the list fetches it. If it failed, the form mounts with a fresh key and the user re-submits cleanly.
- **Negative amounts, scientific notation, >2 decimals** — rejected by the same regex on both client and server (`/^\d+(\.\d{1,2})?$/`).
- **Same-day entries** — ordered deterministically by `created_at DESC`.
- **Display dates** — parsed as local midnight, not UTC, so `2024-01-15` displays as `15 Jan` in all timezones.
- **Empty filter state** — "No expenses in this category" with a Clear filter button, distinct from "No expenses yet" when the database is empty. The distinction tells the user whether they have no data or just no matching data.

---

## Tests

```bash
cd backend && npm test
```

37 tests across three files:

| File | What it covers |
|---|---|
| `money.test.ts` | `rupeesToPaise` accepts `"324"`, `"324.5"`, `"324.50"`, `"0.01"`; rejects `"-1"`, `"abc"`, `"1.234"`, `""`, `"1e2"` |
| `expenses.test.ts` | Idempotency sequential, idempotency concurrent (`Promise.all`), same-key-different-body, missing header, invalid amounts |
| `expenses-read.test.ts` | Empty list, newest-first sort, same-date tiebreaker, category filter, missing category, case sensitivity, invalid sort param, integer `amount_paise` |

Frontend tests are omitted intentionally — reasoning above.

---

## What I'd do next

- Edit and delete expenses with soft-delete and an audit trail (so you can see what changed and when).
- `GET /expenses/summary` returning total-by-category, so the client doesn't have to sum the full list to show a breakdown.
- Background job to expire `idempotency_keys` older than 24h — one cron entry, bounds table growth in production.
- Frontend integration tests with MSW mocking the API, covering the form submit → success → key refresh flow and the retry-with-same-key flow.
