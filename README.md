# Bandwagon

**Race-proof team formation for a 10,000-person hackathon.** Teams with expiring invite codes, join requests the leader accepts or declines, and a live "looking for teammates" board. Hundreds of people can press Join at the same second and **exactly one** gets the last seat.

- **Live demo:** _add your Render URL here after deploying (see below)_. Use *Lead a team with one seat left* / *Join as a solo hacker* on the sign-in page; no sign-up needed.
- **Design doc (1 page):** [docs/design-doc.md](docs/design-doc.md) · **Load test:** [docs/LOADTEST.md](docs/LOADTEST.md) · **Chaos test:** [docs/CHAOS.md](docs/CHAOS.md)
- **PRD / TRD:** [docs/PRD.md](docs/PRD.md) · [docs/TRD.md](docs/TRD.md) · **Video script:** [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md)

## What's proven, and where

| Requirement | How | Evidence |
|---|---|---|
| 50 people, 1 last seat, exactly 1 wins | Team row lock + conditional claim + `CHECK (member_count <= max_size)` | [`apps/api/test/race.test.ts`](apps/api/test/race.test.ts): 8 scenarios × 5 rounds × 50 concurrent HTTP requests |
| One team per person per hackathon | Structural: a single nullable `participants.team_id` | [`migrations/001_init.sql`](apps/api/migrations/001_init.sql), race + schema tests |
| Retries never double-join or double-create | `Idempotency-Key` row inside the command's transaction; byte-identical replays | [`idempotency.test.ts`](apps/api/test/idempotency.test.ts), chaos double-sends |
| Leadership passes on; last one out deletes the team | Same transaction as the leave; deferred `leader_is_member` FK | [`teams.test.ts`](apps/api/test/teams.test.ts) |
| Invite codes expire, can't be brute-forced | 60-bit Crockford codes; Postgres-backed limits per user/IP; 5 wrong → 15-min lockout | [`invites.test.ts`](apps/api/test/invites.test.ts) |
| Only the leader accepts, declines, removes | Checked under the team lock | teams/requests tests |
| Audit log of every change | Same transaction; append-only by trigger | [`audit.test.ts`](apps/api/test/audit.test.ts), chaos reconciliation |
| Real-time board and team pages | SSE fed by `pg_notify` (delivered only on commit), 150 ms coalescing | [`events.test.ts`](apps/api/test/events.test.ts) |
| Teammate suggestions with explained scoring | 50·complement + 30·time-zone overlap + 20·novelty, reasons in words | [`scoring.test.ts`](apps/api/test/scoring.test.ts), `GET /api/hackathons/:id/suggestions/people` |
| ≥ 20 API tests in CI | **86 API tests** (+14 shared, +6 web) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Seed 10k users / 2k teams; p95 < 200 ms at 100 users | Deterministic seed in ~7 s; k6 | **p95 19.5 ms**, [LOADTEST.md](docs/LOADTEST.md) |
| React UI, phone + keyboard | Party-lineup design system; skip link, focus management, live regions | axe-core: 0 violations on 6 pages ([review script](apps/web/scripts/review.mjs)) |
| Bonus: optimistic UI + rollback | Join, request, accept/decline, team edits (412 conflict flow) | `apps/web/src/lib/mutations.ts` |
| Bonus: Docker Compose | `docker compose up --build` | [`docker-compose.yml`](docker-compose.yml) |
| Bonus: metrics | Prometheus at `/metrics` (latency histogram, seat-claim outcomes, retries, SSE clients) | [`lib/metrics.ts`](apps/api/src/lib/metrics.ts) |
| Bonus: chaos test | SIGKILL the server 6× mid-join; 0 violations | `pnpm chaos`, [CHAOS.md](docs/CHAOS.md) |
| Bonus: Race Arena | 50 concurrent bot transactions on demand, in the UI | `/h/hack4hack-2026/arena` |

## Run it

### One command (Docker)
```bash
docker compose up --build        # → http://localhost:8080 (first boot seeds 10k users / 2k teams)
```

### Without Docker
Needs Node 22 and pnpm 11. Postgres comes from npm (native binaries), so no install is needed.
```bash
pnpm install
pnpm -F @bw/api localdb                       # terminal 1: Postgres 16 on :54329
pnpm -F @bw/api seed --reset                  # 10,000 users, 2,000 teams
pnpm -F @bw/web build
cd apps/api && DEMO_MODE=true WEB_DIST=../web/dist pnpm dev   # → http://localhost:8080
# or for UI work: pnpm -F @bw/web dev → http://localhost:5173 (proxies /api)
```

### Tests
```bash
pnpm test                                     # shared + API (real Postgres) + web
pnpm -F @bw/api test race                     # just the concurrency suite
pnpm -F @bw/api build && pnpm chaos           # chaos test → docs/CHAOS.md
k6 run -e BASE_URL=http://127.0.0.1:8080 loadtest/board.k6.js
```
API tests use `TEST_DATABASE_URL` (default: the local DB above). In CI it's a `postgres:16` service container.

## Deploy (free tier: Render + Neon)
1. Create a free Neon project. Copy the **pooled** connection string and the **direct** (unpooled) one.
2. Push this repo to GitHub. In Render choose **New → Blueprint** and pick the repo; it reads [`render.yaml`](render.yaml).
3. When prompted, set `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct; needed for LISTEN/NOTIFY) and `APP_ORIGIN` (your `https://….onrender.com` URL). `SESSION_SECRET` is generated for you.
4. The first boot migrates and seeds the demo data (about 30 s). The free instance sleeps after 15 minutes idle, so the first request after that takes a moment.

## Architecture
```
React SPA ──HTTPS/JSON──▶ Fastify (Node 22) ──SQL──▶ PostgreSQL 16
    ▲                        │  one transaction per command, lock order team → participant → request/invite
    └──── SSE ◀── hub ◀─ LISTEN bw_events ◀── pg_notify (in-transaction: only committed changes are announced)
```
`apps/api` (Fastify, postgres.js, zod) · `apps/web` (React 18, TanStack Query, React Router, Radix, CSS Modules) · `packages/shared` (schemas, skills, error codes, time-zone math, invite codes).

## Design
The UI's visual world, *Party Lineup*, was chosen with the impeccable design process: participants are cards with a stat block, and teams are a hand of seats dealt live. Product context is in [PRODUCT.md](PRODUCT.md), the design system in [DESIGN.md](DESIGN.md), and the surface brief in `apps/web/.impeccable/surfaces/`.
