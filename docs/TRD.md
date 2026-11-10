# Bandwagon — Technical Requirements & Design

Companion to [PRD.md](PRD.md). This document is the build contract: architecture, data model, concurrency protocol, API, real-time design, security, testing and operations. The 1-page summary for judges is [design-doc.md](design-doc.md).

---

## 1. Architecture

```
 Browser (React SPA)                       Render free web service (1 container)
 ┌───────────────────────┐   HTTPS JSON    ┌──────────────────────────────────────┐
 │ TanStack Query cache  │ ──────────────▶ │ Fastify (Node 22)                     │
 │ optimistic mutations  │                 │  ├─ auth (JWT in httpOnly cookie)     │
 │ EventSource (SSE)     │ ◀────────────── │  ├─ zod validation on every route     │
 └───────────────────────┘   text/event-   │  ├─ services: one SQL transaction per │
                              stream       │  │   command, row locks, retries      │
                                           │  ├─ SSE hub (per-hackathon fan-out,   │
                                           │  │   150 ms coalescing)               │
                                           │  ├─ LISTEN bw_events ◀───────┐        │
                                           │  └─ static SPA (same origin)  │        │
                                           └──────────────┬───────────────┼────────┘
                                                          │ SQL           │ NOTIFY (on commit)
                                                   ┌──────▼───────────────┴──┐
                                                   │ PostgreSQL 16 (Neon)     │
                                                   │ constraints + triggers   │
                                                   │ = the referee            │
                                                   └──────────────────────────┘
```

**Decisions**

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript end-to-end, pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`) | One set of zod schemas validates server input and types the client |
| HTTP | Fastify 5 | Low overhead and schema-first validation; built-in pino logging |
| DB | PostgreSQL 16 via `postgres` (postgres.js) | Row locks, CHECK and deferrable FK constraints, triggers, LISTEN/NOTIFY. Races are decided in the one place that sees every request |
| Real-time | Server-Sent Events | One-way server→client is all the board needs. Plain HTTP passes proxies, cookies authenticate it, and the browser reconnects automatically |
| Cross-instance fan-out | Postgres `pg_notify` inside the transaction | Delivered **only if the transaction commits**, so no event exists for a change that rolled back. No Redis needed |
| Frontend | React 18 + Vite, TanStack Query, React Router, Radix primitives, CSS Modules + tokens | Accessible primitives without a templated look; query cache makes optimistic rollback straightforward |
| Hosting | One Docker image serves API and SPA on one origin (Render free) + Neon free Postgres | Same origin means no CORS and SameSite cookies just work; one deployable |

## 2. Data model

```sql
users(
  id uuid PK, email citext UNIQUE, password_hash text,
  display_name text CHECK 1..60, bio text CHECK ≤280,
  skills text[] CHECK cardinality ≤12,             -- validated against catalogue in app
  timezone text,                                   -- IANA, e.g. Asia/Kolkata
  utc_offset_minutes smallint,                     -- derived on write (DST drift accepted, see §11)
  work_start_hour smallint DEFAULT 9, work_end_hour smallint DEFAULT 22,  -- local hours
  role text CHECK IN ('participant','organizer'), is_demo bool, created_at)

hackathons(
  id uuid PK, slug text UNIQUE, name text,
  min_team_size smallint CHECK ≥1, max_team_size smallint CHECK ≥min AND ≤10,
  formation_closes_at timestamptz, created_at)

teams(
  id uuid PK, hackathon_id uuid FK, number int (global sequence, "No. 0412"),
  name text CHECK 2..40, description text ≤280,
  looking_for text[], skills text[] (union of members', maintained by trigger),
  join_policy text CHECK IN ('open','approval'),
  leader_id uuid NOT NULL,
  member_count smallint NOT NULL DEFAULT 0,
  min_size smallint, max_size smallint,           -- snapshot of hackathon rule
  roster_locked bool DEFAULT false,
  version int NOT NULL DEFAULT 1,                  -- bumped on every change
  created_at, updated_at,
  UNIQUE (id, hackathon_id),
  CONSTRAINT seats_within_bounds CHECK (member_count BETWEEN 0 AND max_size),
  CONSTRAINT leader_is_member FOREIGN KEY (id, leader_id)
      REFERENCES participants(team_id, user_id) DEFERRABLE INITIALLY DEFERRED)
  UNIQUE INDEX ON teams (hackathon_id, lower(name))

participants(                                      -- registration + membership in ONE row
  hackathon_id uuid FK, user_id uuid FK, PRIMARY KEY (hackathon_id, user_id),
  team_id uuid NULL,                               -- ← one team per person, structurally
  team_joined_at timestamptz NULL,
  looking_for_team bool DEFAULT true, registered_at,
  UNIQUE (team_id, user_id),
  FOREIGN KEY (team_id, hackathon_id) REFERENCES teams(id, hackathon_id) ON DELETE SET NULL (team_id))

invite_codes(id uuid PK, team_id FK SET NULL (so a dead team’s code says “team gone”, not “invalid”), code text UNIQUE, created_by, created_at,
  expires_at, max_uses smallint NULL, uses smallint DEFAULT 0, revoked_at NULL,
  CHECK (max_uses IS NULL OR uses ≤ max_uses))

join_requests(id uuid PK, team_id FK CASCADE, hackathon_id, user_id, message ≤280,
  status CHECK IN ('pending','accepted','declined','cancelled'), created_at, decided_at, decided_by)
  UNIQUE INDEX ON join_requests (team_id, user_id) WHERE status = 'pending'

audit_log(id bigint IDENTITY PK, hackathon_id, team_id (no FK: survives deletion), team_name,
  actor_id, action text, subject_id, details jsonb, request_id, created_at)
  -- trigger: BEFORE UPDATE OR DELETE → RAISE EXCEPTION (append-only)

idempotency_keys(user_id, key, PRIMARY KEY (user_id, key), request_hash, status_code, response json (not jsonb: replays keep the original bytes and key order), created_at)
rate_limits(bucket text, window_start timestamptz, count int, PRIMARY KEY (bucket, window_start))
```

**Why membership lives on `participants.team_id`:** a single nullable column can't point at two teams, so "one team per person per hackathon" can't even be represented as data, let alone violated. Joining is a conditional update (`SET team_id = $t WHERE team_id IS NULL`). Two concurrent joins by the same person serialise on that row, and the loser updates zero rows.

**Triggers (the referee):**
- `participants_team_change` (AFTER UPDATE OF team_id): decrements `member_count` on the old team and increments it on the new one, recomputes `teams.skills`, and bumps `version`. Because the count changes in the same statement as the membership, `seats_within_bounds` makes overfilling a team a constraint violation **even if application code is wrong**.
- `users_skills_change`: recomputes `skills` for the user's teams.
- `audit_log_append_only`: rejects UPDATE and DELETE.

**Indexes (board path):** `teams (hackathon_id, created_at DESC, id DESC)`, GIN on `teams.skills` and `teams.looking_for`, `pg_trgm` GIN on `teams.name`, `participants (hackathon_id, looking_for_team) WHERE team_id IS NULL`, GIN on `users.skills`.

## 3. Concurrency protocol

Every command runs in **one READ COMMITTED transaction** and follows the **lock order: team row → participant row → request / invite rows**. Every multi-row command acquires locks in that order, so lock waits can't form a cycle. As a backstop, `withTx` retries `40P01` (deadlock) and `40001` (serialization) up to 3 times with jitter. That's safe because the idempotency row is part of the same transaction.

### 3.1 Last-seat join (invite code, open join, or accept)

```sql
BEGIN;
SELECT ... FROM teams WHERE id = $team FOR UPDATE;          -- 50 callers queue here
-- under the lock: team exists? same hackathon? not locked? member_count < max_size?
--   no → ROLLBACK, 409 TEAM_FULL (a clear answer, not an exception)
UPDATE participants SET team_id = $team, team_joined_at = now()
 WHERE hackathon_id = $h AND user_id = $me AND team_id IS NULL;  -- 0 rows → 409 ALREADY_IN_TEAM
-- trigger: member_count += 1  (CHECK seats_within_bounds is the backstop)
UPDATE join_requests SET status='cancelled' WHERE user_id=$me AND hackathon_id=$h AND status='pending';
INSERT INTO audit_log ...;  SELECT pg_notify('bw_events', ...);
COMMIT;
```

50 simultaneous callers serialise on the team row. Each one holds it for about a millisecond, and each re-reads `member_count` after acquiring it. The first takes the seat; the other 49 see `member_count = max_size` and get `409 TEAM_FULL`. No retry loop, no lost updates, and no global lock: contention is per team, so 2,000 teams join in parallel.

**Alternatives considered**
- *SERIALIZABLE isolation*: also correct, but 49 of 50 abort with `40001` and must retry, which means more latency and more load at exactly the wrong moment.
- *Optimistic version check*: same retry storm.
- *Redis / distributed lock*: a second system that can disagree with the database during a failover, and the DB still has to enforce the invariant anyway.
- *App-level mutex*: breaks the moment there are two instances.

### 3.2 Other commands (all under the team lock unless noted)

| Command | Steps after `SELECT team FOR UPDATE` | Failure codes |
|---|---|---|
| Create team | insert team (`leader_id = me`, FK deferred) → claim participant → create invite → cancel my pending requests | 409 ALREADY_IN_TEAM, 409 NAME_TAKEN |
| Accept request | verify leader → capacity → claim requester → `UPDATE request SET accepted WHERE status='pending'` (0 rows → rollback) → cancel requester's other pending | 403 NOT_LEADER, 409 TEAM_FULL, 409 ALREADY_IN_TEAM, 409 REQUEST_NOT_PENDING |
| Decline | verify leader → conditional status update | 403, 409 |
| Leave | `UPDATE participants SET team_id=NULL WHERE team_id=$team` → if `member_count = 0` delete team, else if I was leader set `leader_id` = earliest `team_joined_at` → if below min, unlock roster | 404 NOT_A_MEMBER |
| Remove member | verify leader, target ≠ me → clear target's `team_id` | 403, 404 |
| Transfer leadership | verify leader, target is member → update `leader_id` | 403, 404 |
| Edit team | `UPDATE … WHERE id AND leader_id = me AND version = $expected` | 412 VERSION_CONFLICT (body carries current team) |
| Lock roster | verify leader, `member_count ≥ min_size` | 409 BELOW_MINIMUM |
| Create request *(team FOR SHARE, then participant FOR UPDATE)* | share-lock team (exists, not full, not locked; can't be deleted mid-request, a bug the chaos test found) → `SELECT participant FOR UPDATE` → not in team, < 5 pending → insert | 409 ALREADY_IN_TEAM, 409 ALREADY_REQUESTED, 409 TOO_MANY_REQUESTS |
| Redeem code | rate-limit check → find code → team lock → capacity → `UPDATE invite_codes SET uses=uses+1 WHERE … not expired/revoked/exhausted` → claim → audit | 404 INVALID_CODE, 410 CODE_EXPIRED, 429 |

**Why accept claims the participant before touching the request row:** if two leaders accept the same person into two teams at once, both block on that person's participant row, before either holds the other's request row. The winner then cancels the loser's request, and the loser gets 0 rows and `409 ALREADY_IN_TEAM`. Reversing the order deadlocks (verified while designing; Postgres would abort one after `deadlock_timeout`).

## 4. Idempotency

1. The client sends `Idempotency-Key: <uuid v4>`, one per user intent, reused on its own automatic retries (2 retries, exponential backoff, only on network errors and 502–504).
2. Inside the command's transaction, before any business logic: `INSERT INTO idempotency_keys (user_id, key, request_hash) ON CONFLICT DO NOTHING RETURNING`.
   - **Row returned:** we own the key; run the command, store `status_code` and `response` in the same transaction, then commit.
   - **No row, and the other transaction is still running:** Postgres blocks our INSERT on the unique index until that transaction ends. Concurrent duplicates therefore wait rather than both executing.
   - **No row, committed:** compare `request_hash` (SHA-256 of method + route + canonical body). If it matches, return the stored response with `Idempotent-Replayed: true`. If not, 422 IDEMPOTENCY_KEY_REUSED.
3. A command that fails with a domain error rolls back, key included, so a retry re-evaluates. That's intentional: a rejected attempt had no effect, so trying again is honest.
4. Independent of keys, the data model makes double effects impossible. A second join of the same person updates 0 rows, and a second team by the same person fails the participant claim. Keys turn those 409s into the original 200 for a genuine retry.
5. Keys expire after 24 h (cleanup job).

## 5. Real-time

- **Producer:** every committed command calls `pg_notify('bw_events', '{"h":hackathonId,"teams":[…],"users":[…],"kind":…}')` inside its transaction. The payload stays under 1 KB because it carries ids, not state.
- **Hub (per instance):** one dedicated `LISTEN` connection (Neon's unpooled URL). Notifications go into a per-hackathon dirty set. Every 150 ms the hub loads snapshots for the dirty teams in one query (`WHERE id = ANY($1)`) and writes a single `event: board` frame to every subscribed client, containing `{teams:[snapshot+version], removed:[ids], people:[…]}`. Personal frames (`request.created`, `request.decided`, `member.removed`) go immediately to that user's connections only.
- **Why coalesce:** with 10,000 viewers and a burst of 200 joins per second, per-event fan-out would mean 2M writes per second. Coalescing at 150 ms caps it at about 7 frames per second per client, whatever the burst size.
- **Ordering:** snapshots carry `version`, and the client applies one only if it's newer than what it holds. Loading snapshots *after* the notification means a frame always reflects committed state at least as new as the event.
- **Reconnect:** `retry: 3000`, a heartbeat comment every 20 s (proxies drop idle streams), and on reconnect the client invalidates its board and team queries, which is a full resync. That's simpler and more honest than replaying gaps from a non-monotonic id.
- **Backpressure:** a client whose socket buffer passes 1 MB is disconnected (it reconnects and resyncs). One slow phone never grows server memory.
- **Scale-out:** each instance LISTENs and fans out to its own clients, so no sticky sessions are needed.

## 6. API (all under `/api`, JSON, OpenAPI at `/api/docs`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /auth/signup` `/auth/login` `/auth/logout`, `GET /auth/me` | — / ✓ | Accounts |
| `POST /auth/demo` `{persona}` | — | Demo login (demo mode only) |
| `PATCH /me` | ✓ | Profile, skills, time zone, hours |
| `GET /hackathons`, `GET /hackathons/:slug` | ✓ | Event + my status |
| `POST /hackathons/:id/register`, `PATCH /hackathons/:id/me` | ✓ | Register, toggle "looking" |
| `GET /hackathons/:id/board/teams` | ✓ | `q, skills[], tz, policy, sort, cursor, limit≤50` |
| `GET /hackathons/:id/board/people` | ✓ | `q, skills[], tz, cursor, limit≤50` |
| `POST /hackathons/:id/teams` | ✓ | Create team |
| `GET /teams/:id`, `PATCH /teams/:id` | ✓ / leader | Team detail; edit (`expectedVersion`) |
| `POST /teams/:id/join` | ✓ | Instant join (open policy) |
| `POST /teams/:id/leave` | member | Leave |
| `POST /teams/:id/members/:userId/remove` | leader | Remove |
| `POST /teams/:id/leader` `{userId}` | leader | Transfer |
| `POST /teams/:id/roster` `{locked}` | leader | Lock/unlock |
| `POST /teams/:id/invites` `{ttlHours,maxUses}` / `DELETE /teams/:id/invites/:inviteId` | leader | New code (revokes old) / revoke |
| `GET /invites/:code` / `POST /invites/redeem` `{code}` | ✓ | Preview / redeem (both rate-limited) |
| `POST /teams/:id/requests` | ✓ | Request to join |
| `POST /requests/:id/accept` `/decline` `/cancel` | leader / requester | Decide |
| `GET /hackathons/:id/me/requests` | ✓ | My outgoing requests |
| `GET /hackathons/:id/suggestions/people` `/teams` | ✓ | Ranked, explained |
| `GET /teams/:id/audit`, `GET /hackathons/:id/audit` | member / organizer | Audit log (keyset) |
| `GET /hackathons/:id/events` | ✓ | SSE stream |
| `POST /demo/race` | ✓ (demo) | Race Arena: 50 concurrent joins for one seat |
| `GET /healthz` `/readyz` `/metrics` | — | Ops |

**Errors** are `{"error":{"code":"TEAM_FULL","message":"…","details":{…}}}`. Codes are an enum in `packages/shared`, and the UI maps them to copy.

## 7. Teammate suggestion scoring

The *have* set is the union of my team's skills (or my own, if solo). *Want* is the team's `looking_for` skills not yet covered. Core roles are frontend, backend, design, data/ML, mobile, and infra; each skill in the catalogue maps to one role.

| Component | Weight | Definition |
|---|---|---|
| **Complement C** | 50 | If *want* is non-empty: `0.7·|cand ∩ want| / |want| + 0.3·G`; otherwise `G`, where `G = min(1, newRoles / min(2, missingRoles))`: bringing two roles nobody covers earns full marks |
| **Time-zone overlap T** | 30 | Hours of working-window overlap on the 24 h UTC circle, taken as the **minimum over all current members** (a meeting needs everyone), capped at 8 h: `min(h,8)/8` |
| **Novelty N** | 20 | `1 − |cand ∩ have| / |cand|`: share of the candidate's skills that are new to the team |

`score = round(50·C + 30·T + 20·N)` (0–100). Each result returns `{score, components:[{key,label,weight,value,points,reason}], matchedSkills, newRoles, overlapHours}`, plus a top-level `scoring` object restating the formula. The candidate pool is solo, looking participants, prefiltered in SQL (skill overlap with *want*/missing roles, or within ±4 h), capped at 800, and scored in a pure, unit-tested function. Ties break on overlap hours, then most recently registered.

## 8. Security

- **AuthN:** argon2id (`@node-rs/argon2`, 19 MiB, t=2). JWT (HS256, 7 days) in the `bw_session` cookie (httpOnly, Secure in production, SameSite=Lax, Path=/). `Authorization: Bearer` is also accepted for tests and k6.
- **CSRF:** SameSite=Lax, plus mutations require `Content-Type: application/json` (cross-site forms can't send it without a CORS preflight, which we never approve), plus an `Origin` check against `APP_ORIGIN` in production.
- **AuthZ:** leader and membership checks run **inside the transaction, under the team lock**, so an authorisation decision can't go stale before the write (the leader can't leave in between).
- **Rate limits:** Postgres-backed fixed windows (atomic upsert, shared across instances) on code redeem and preview (10 per 10 min per user, 30 per IP, 5 failures → 15-minute lockout), login (10 per 10 min per email, 30 per IP), and signup (10 per hour per IP). Everything else gets an in-memory per-user/IP limiter (`@fastify/rate-limit`, 600 per minute, configurable).
- **Invite entropy:** 60 bits from `crypto.randomBytes`, 12 Crockford base32 characters, normalised on input.
- **Validation:** zod schemas on params, query, and body. Unknown keys are rejected. Strings are trimmed, length-bounded, and stripped of control characters. Skills come from the catalogue enum. Time zones are checked with `Intl`. The body limit is 16 KB.
- **Headers:** `@fastify/helmet` with a strict CSP (self only; no inline scripts), HSTS in production, `X-Content-Type-Options`.
- **Information hygiene:** login errors don't reveal whether an account exists; 500s return a request id, not a stack; invite codes are visible only to their team's leader.

## 9. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | scoring, invite code generate/normalise, time-zone overlap, error mapping |
| API integration (≥ 20) | Vitest + real Postgres + real HTTP (`app.listen(0)` + undici, 64 sockets) | every rule R1–R8, idempotency, auth, validation, audit, SSE |
| **Race** | same | 50 users × last seat via invite code, via open join, via 10 concurrent accepts, same person into 2 teams, all members leaving at once; each repeated over several rounds, asserting exactly 1 winner **and** `bw_check_invariants()` = ∅ |
| Chaos | `scripts/chaos.ts` | Spawns the server, runs concurrent join/leave/accept load, SIGKILLs the process at random points 6 times, restarts, then checks invariants. Writes `docs/CHAOS.md` |
| Load | k6 | 100 VUs on `GET /board/teams` with mixed filters over a 10k-user / 2k-team seed; threshold `p(95)<200` |
| CI | GitHub Actions | `test` (typecheck, unit, API, web build), `load` (seed + k6 + artifact), `chaos` |

`bw_check_invariants()` is a SQL function that returns violation rows. It checks that `member_count` equals the actual member count, that `member_count` is within bounds, that the leader is a member, that no team is empty, and that no accepted request lacks a matching membership.

## 10. Performance budget

- Board query: one indexed keyset scan + one lateral member aggregate for ≤ 24 teams + PK join to the leader for time-zone filtering; measured 1.4–2.3 ms in the DB. **Each card's JSON is built in Postgres** (`json_build_object(...)::text`) and passed through untouched: profiling showed ~40% of Node CPU in parse/re-serialize. A contract test pins it to `TeamSnapshot`. Total count runs in parallel and is cached 3 s per filter.
- `WEB_CONCURRENCY=N` forks N workers (each with its own pool and LISTEN connection); measured results in [LOADTEST.md](LOADTEST.md).
- Pool: 20 connections (Neon free allows more, but Render free has 0.1 CPU).
- Compression on (`@fastify/compress`, br/gzip) for board JSON > 1 KB.
- Web: route-level code splitting, self-hosted variable fonts (two files), no runtime CSS-in-JS. First-load JS target < 150 KB gzipped.

## 11. Trade-offs accepted

- **Stateless JWT:** logout clears the cookie, but a stolen token stays valid until it expires (7 days). A sessions table is the fix (one indexed lookup per request).
- **`utc_offset_minutes` stored at write time:** DST shifts are off by an hour until the profile is saved again. Fine for "within ±3 h" matching.
- **Full resync on reconnect** instead of gap replay: costs one board fetch per reconnect, but is never wrong.
- **Min size is a readiness gate, not a hard invariant:** teams grow from 1, so "≥ min at all times" is impossible. It's enforced at roster lock and surfaced at the deadline.
- **Free-tier hosting:** Render free has 0.1 vCPU and sleeps after 15 minutes idle, so the live URL can cold-start in about 30 s. Load-test numbers come from the documented CI/local environment, not the free instance.

## 12. Operations

- Sessions run with `TimeZone=UTC`; `LIMITS_SCALE` multiplies the Postgres-backed limits for load/chaos environments only.

- `GET /healthz` (process), `GET /readyz` (DB round-trip), `GET /metrics` (Prometheus): `http_request_duration_seconds{route,method,status}`, `bw_join_attempts_total{via,outcome}`, `bw_tx_retries_total{code}`, `bw_idempotent_replays_total`, `bw_sse_clients`, `bw_sse_frames_total`.
- Structured JSON logs (pino) with `reqId` propagated into audit rows.
- Migrations run on boot under `pg_advisory_lock`, so concurrent boots are safe.
- Graceful shutdown: stop accepting, close SSE streams with a `retry` hint, drain the pool.
- Config via env (zod-validated): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `SESSION_SECRET`, `APP_ORIGIN`, `DEMO_MODE`, `SEED_IF_EMPTY`, `RATE_LIMIT_MAX`, `PORT`.
