# Bandwagon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A race-proof hackathon team-formation service (API, live board, React UI, tests, load/chaos proof, deploy) that meets every requirement in the brief.

**Architecture:** A pnpm monorepo. A Fastify API in which every command is one Postgres transaction following a fixed lock order, with invariants enforced by constraints and triggers. Live updates go out as SSE frames fanned out from `LISTEN/NOTIFY`, with 150 ms coalescing. A React SPA served from the same origin.

**Tech Stack:** Node 22, TypeScript 5, Fastify 5, postgres.js, PostgreSQL 16, zod, Vitest, undici, k6, React 18, Vite, TanStack Query 5, React Router 6, Radix UI, CSS Modules, Docker, GitHub Actions, Render + Neon.

**Spec:** [docs/PRD.md](../../PRD.md), [docs/TRD.md](../../TRD.md), visual direction in `.impeccable/surfaces/` (direction contract).

## Global Constraints

- Node ≥ 22, pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`).
- Team size: hackathon `min_team_size` 2, `max_team_size` 4 for the demo event; schema allows max ≤ 10.
- Invite codes: 12 chars, alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, displayed `XXXX-XXXX-XXXX`, TTL options 1/24/48/168 h, default 48 h.
- Rate limits: redeem 10/10 min/user, 30/10 min/IP, 5 failures → 15-min lockout; login 10/10 min/email, 30/10 min/IP; signup 10/h/IP; global 600/min (env `RATE_LIMIT_MAX`).
- Max 5 pending join requests per participant per hackathon; messages ≤ 280 chars; team name 2–40, description ≤ 280, display name 1–60, skills 1–12 from catalogue.
- Scoring weights: complement 50, time zone 30, novelty 20; overlap cap 8 h; candidate pool cap 800.
- Lock order in every transaction: team row → participant row → request/invite rows. `withTx` retries `40P01`/`40001` up to 3 times.
- Every mutating route accepts `Idempotency-Key`; replay returns stored response + `Idempotent-Replayed: true`; mismatched body → 422.
- Error body `{"error":{"code","message","details?"}}`; codes from `packages/shared/src/errors.ts` only.
- SSE: `retry: 3000`, heartbeat 20 s, coalesce 150 ms, disconnect at 1 MB buffered.
- Board: limit default 24, max 50; p95 < 200 ms at 100 VUs over 10,000 users / 2,000 teams.
- UI: works at 360 px wide, keyboard only, WCAG 2.2 AA, `prefers-reduced-motion`, touch targets ≥ 44 px.
- Product name "Bandwagon", demo hackathon "Hack4Hack 2026" (slug `hack4hack-2026`).

## Review Focus

1. **Messy invite code input** (lowercase, spaces, missing/extra dashes, `O`/`I`/`L` look-alikes, pasted link `…/join/K7QM-…`): it should redeem. Test in Task 1 (`normalizeInviteCode`) and Task 6 (`redeem accepts lowercase dashed code`).
2. **Acting on a team that just disappeared** (last member left while you had its page open, or a code for a deleted team): you should get a clear 404 TEAM_NOT_FOUND / 410, and the board card should vanish live. Test in Task 6 (`redeem for deleted team returns 410`) and Task 12 (`board frame lists removed team id`).
3. **Phone sleeps and the SSE stream drops**: on reconnect the client should resync, with no stale open seat. Task 16's live hook invalidates queries on `open` after an `error`; covered by Task 12's `stream sends hello with retry`.
4. **Unicode/emoji/very long unbroken team names**: they should validate by length after trim, be stored as-is, and never overflow a card. Test in Task 5 (`create team accepts emoji name, rejects 41 chars`); CSS `overflow-wrap:anywhere` in Task 15.
5. **Half- and quarter-hour time zones and the date line** (Asia/Kathmandu +5:45, America/St_Johns −3:30, Pacific/Auckland vs America/Los_Angeles): overlap should be computed on the 24 h circle. Test in Task 1 (`overlapHours handles +5:45 and wraparound`).

---

### Task 1: Monorepo + shared package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `.nvmrc`
- Create: `packages/shared/{package.json,tsconfig.json}`, `packages/shared/src/{index.ts,skills.ts,errors.ts,invite.ts,tz.ts,schemas.ts}`
- Test: `packages/shared/test/{invite.test.ts,tz.test.ts}`

**Interfaces:**
- Produces: `SKILLS: readonly {id:string;label:string;role:Role}[]`, `type Role = 'frontend'|'backend'|'design'|'data'|'mobile'|'infra'`, `ROLES`, `skillRole(id): Role`;
  `type ErrorCode` (UNAUTHENTICATED, FORBIDDEN, NOT_LEADER, VALIDATION, NOT_FOUND, TEAM_NOT_FOUND, TEAM_FULL, ROSTER_LOCKED, APPROVAL_REQUIRED, ALREADY_IN_TEAM, NOT_A_MEMBER, NOT_REGISTERED, NAME_TAKEN, EMAIL_TAKEN, INVALID_CREDENTIALS, INVALID_CODE, CODE_EXPIRED, ALREADY_REQUESTED, TOO_MANY_REQUESTS, REQUEST_NOT_PENDING, BELOW_MINIMUM, VERSION_CONFLICT, FORMATION_CLOSED, RATE_LIMITED, IDEMPOTENCY_KEY_REUSED, CANNOT_REMOVE_SELF, INTERNAL), `ERROR_STATUS`, `ERROR_COPY`;
  `normalizeInviteCode(input:string): string|null`, `formatInviteCode(code:string): string`, `INVITE_ALPHABET`;
  `type WorkWindow = {offsetMinutes:number; startHour:number; endHour:number}`, `overlapHours(a,b): number`, `groupOverlapHours(cand, members[]): number`;
  zod schemas `SignupBody, LoginBody, ProfilePatch, CreateTeamBody, PatchTeamBody, BoardTeamsQuery, BoardPeopleQuery, RedeemBody, CreateInviteBody, CreateRequestBody` and types `TeamSnapshot, PersonSnapshot, TeamDetail, Suggestion, BoardFrame, Me`.

- [ ] **Step 1: Write failing tests**: `normalizeInviteCode('k7qm-4xht 9rjp') === 'K7QM4XHT9RJP'`; `'K7QM-4XHT-9RJO'` maps `O→0`; `'I'`/`'L'`→`1`; `'https://x/join/K7QM-4XHT-9RJP'` extracts; 11 chars → `null`; `'U'` → `null`; `formatInviteCode('K7QM4XHT9RJP') === 'K7QM-4XHT-9RJP'`. `overlapHours({0,9,17},{0,9,17}) === 8`; `({+330,9,22},{−300,9,22})` = 3.5; `({+345,9,17},{+345,9,17})` = 8; Auckland (+780) vs LA (−480) 9–22 each = 0 < x computed on circle (assert equals hand value 0); `groupOverlapHours` = min over members.
- [ ] **Step 2: Run** `pnpm -F @bw/shared test` → FAIL (modules missing).
- [ ] **Step 3: Implement** the shared modules. Overlap is done by expanding each window to UTC minute intervals on [0,1440) (splitting at wrap) and summing the intersection length. Skill catalogue has ~36 entries across 6 roles.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `chore: scaffold monorepo and shared domain package`.

### Task 2: Database schema, migrator, invariants

**Files:**
- Create: `docker-compose.yml` (db service only for now), `apps/api/migrations/001_init.sql`, `apps/api/src/db/{pool.ts,migrate.ts,tx.ts}`, `apps/api/src/config.ts`
- Test: `apps/api/test/schema.test.ts`, `apps/api/test/helpers/db.ts`

**Interfaces:**
- Produces: `createSql(url:string, opts?:{max?:number}): Sql`; `migrate(sql): Promise<string[]>` (advisory lock 727001); `withTx<T>(sql, fn:(tx)=>Promise<T>, opts?:{retries?:number}): Promise<T>`; SQL function `bw_check_invariants() RETURNS TABLE(kind text, team_id uuid, detail text)`; `loadConfig(env): Config`. Test helper `resetDb(sql)` truncates all tables except migrations.

- [ ] **Step 1: Failing tests**: migrations apply twice idempotently; inserting a second team membership for the same participant is impossible (`UPDATE participants SET team_id` where not null → 0 rows); a raw SQL attempt to push `member_count` past `max_size` raises `23514 seats_within_bounds`; `DELETE FROM audit_log` raises; leader FK violation at commit when leader isn't a member raises `23503`; `bw_check_invariants()` returns 0 rows on a consistent fixture and 1 row after manually corrupting `member_count` with the trigger disabled.
- [ ] **Step 2: Run** `pnpm -F @bw/api test schema` → FAIL.
- [ ] **Step 3: Implement** the TRD §2 schema verbatim plus triggers `participants_team_change`, `users_skills_change`, `audit_log_append_only`, extensions `citext`, `pg_trgm`, sequence `team_number_seq`. `withTx` uses `sql.begin`, and retries on codes `40P01`/`40001` with 5–25 ms jitter.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(db): schema with structural one-team rule, seat CHECK, append-only audit`.

### Task 3: App skeleton, errors, auth

**Files:**
- Create: `apps/api/src/{app.ts,server.ts}`, `src/lib/{errors.ts,http.ts}`, `src/plugins/{auth.ts,security.ts}`, `src/modules/auth/{routes.ts,service.ts}`, `src/modules/hackathons/routes.ts`, `src/modules/ops/routes.ts`
- Test: `apps/api/test/helpers/server.ts`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas/errors, Task 2 sql/withTx/config.
- Produces: `buildApp(config, deps?:{sql?:Sql}): Promise<FastifyInstance>`; `class AppError {code; status; details}`, `fail(code, details?): never`; `app.authenticate` preHandler and `req.user: {id, role}`; test helper `startTestServer(): Promise<{url:string; sql:Sql; app; close()}>` and `client(url)` with `.signup(overrides?)`, `.as(token)` returning `{get, post, patch, del}` (sets JSON, Bearer, optional Idempotency-Key); `seedHackathon(sql, {min,max,slug}): Promise<Hackathon>`.

- [ ] **Step 1: Failing tests** (`auth.test.ts`): signup returns 201 + cookie, password not echoed; duplicate email → 409 EMAIL_TAKEN; invalid body (bad email, 7-char password, unknown skill `cobol9`, unknown key) → 400 VALIDATION with field paths; login wrong password → 401 INVALID_CREDENTIALS identical message for unknown email; `GET /auth/me` without token → 401; 11th login for same email in window → 429 with `Retry-After`; demo login returns persona user when `DEMO_MODE`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** auth with argon2id, JWT cookie `bw_session`, Bearer fallback, zod type provider, error handler mapping `AppError` and zod errors, helmet/CSP, JSON-only mutations, `GET /healthz` `/readyz`. Signup auto-registers in every open hackathon.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): app skeleton, validation, auth`.

### Task 4: Idempotency + rate limiting

**Files:**
- Create: `apps/api/src/lib/{idempotency.ts,rateLimit.ts}`, `apps/api/src/lib/command.ts`
- Test: `apps/api/test/idempotency.test.ts` (with Task 5's create route) and unit tests in `ratelimit.test.ts`

**Interfaces:**
- Produces: `hit(sql, bucket:string, limit:number, windowSec:number): Promise<{allowed:boolean; count:number; retryAfterSec:number}>`; `runCommand<T>(req, reply, fn:(ctx:{tx; userId; requestId})=>Promise<{status:number; body:T}>)`, which wraps `withTx` + idempotency + error mapping. All mutation routes use it.

- [ ] **Step 1: Failing tests**: `hit` allows 3 of limit 3 then denies the 4th with retryAfter > 0; 20 parallel `hit` calls with limit 10 → exactly 10 allowed. Idempotency: same key twice on create team → identical body, second has `Idempotent-Replayed: true`, one team in DB; same key different body → 422; 10 concurrent identical requests → 1 team, 10 identical 201 bodies.
- [ ] **Step 2–4:** Run → FAIL → implement per TRD §4 → PASS.
- [ ] **Step 5: Commit** `feat(api): transactional idempotency keys and shared rate limiter`.

### Task 5: Teams commands + audit + notify

**Files:**
- Create: `apps/api/src/modules/teams/{routes.ts,service.ts,queries.ts}`, `apps/api/src/lib/{audit.ts,notify.ts}`
- Test: `apps/api/test/teams.test.ts`

**Interfaces:**
- Produces: `lockTeam(tx, teamId): Promise<TeamRow>` (throws TEAM_NOT_FOUND); `claimSeat(tx, team:TeamRow, userId, via:'create'|'code'|'open'|'request'): Promise<void>` (capacity, lock, formation checks; ALREADY_IN_TEAM); `releaseSeat(tx, team, userId, reason:'left'|'removed'): Promise<{deleted:boolean; newLeaderId?:string}>`; `createTeam, joinOpenTeam, leaveTeam, removeMember, transferLeader, setRosterLock, updateTeam`; `getTeamSnapshots(sql, ids): Promise<TeamSnapshot[]>`; `getTeamDetail(sql, teamId, viewerId): Promise<TeamDetail>`; `audit(tx, e:{hackathonId; teamId?; teamName?; actorId?; action; subjectId?; details?; requestId?})`; `notify(tx, e:{h:string; teams?:string[]; removed?:string[]; users?:string[]; personal?:{userId; kind; payload}[]})`.

- [ ] **Step 1: Failing tests**: create → leader is member, count 1, invite exists, audit `team.created` + `member.joined`; second create same user → 409 ALREADY_IN_TEAM; duplicate name different case → 409 NAME_TAKEN; emoji name `"🚀 Rocket"` accepted, 41 chars → 400; open join works, approval team join → 409 APPROVAL_REQUIRED; leader leaves → earliest joiner becomes leader + audit `leader.changed`; last member leaves → team gone, audit `team.deleted` keeps name; member cannot remove (403 NOT_LEADER); leader removes member; leader cannot remove self (409 CANNOT_REMOVE_SELF); roster lock below min → 409 BELOW_MINIMUM; PATCH with stale `expectedVersion` → 412 VERSION_CONFLICT with `details.team`; non-member GET audit → 403.
- [ ] **Step 2–4:** FAIL → implement per TRD §3 → PASS.
- [ ] **Step 5: Commit** `feat(api): team lifecycle with lock-ordered transactions and audit`.

### Task 6: Invite codes

**Files:** Create `apps/api/src/modules/invites/{routes.ts,service.ts}`, `apps/api/src/lib/inviteCode.ts`; Test `apps/api/test/invites.test.ts`

**Interfaces:** Produces `generateInviteCode(): string` (randomBytes → 12 alphabet chars); `createInvite(ctx, teamId, {ttlHours, maxUses}) / revokeInvite / previewInvite(sql, code, userId) / redeemInvite(ctx, code)`.

- [ ] **Step 1: Failing tests**: redeem joins; `redeem accepts lowercase dashed code`; expired (set `expires_at` past) → 410 CODE_EXPIRED; regenerate revokes old → old 410; `maxUses:1` second redeemer → 410; `redeem for deleted team returns 410`; 6th wrong code within 15 min → 429 RATE_LIMITED even with a correct code next; preview shows team name/seats, not the code; non-leader create invite → 403.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(api): expiring, rate-limited invite codes`.

### Task 7: Join requests

**Files:** Create `apps/api/src/modules/requests/{routes.ts,service.ts}`; Test `apps/api/test/requests.test.ts`

**Interfaces:** Produces `createRequest(ctx, teamId, message?) / acceptRequest(ctx, requestId) / declineRequest / cancelRequest / listMyRequests(sql, hackathonId, userId)`.

- [ ] **Step 1: Failing tests**: request → leader sees it in team detail; duplicate pending → 409 ALREADY_REQUESTED; 6th pending → 409 TOO_MANY_REQUESTS; accept → member, other pending requests of that user become `cancelled`; non-leader accept → 403; accept into full team → 409 TEAM_FULL; decline → `declined`; requester cancel → `cancelled`, then leader accept → 409 REQUEST_NOT_PENDING; personal notify rows emitted (spy on `notify`).
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(api): join requests with leader decisions`.

### Task 8: Race tests (headline proof)

**Files:** Test `apps/api/test/race.test.ts`, helper `apps/api/test/helpers/race.ts`

**Interfaces:** Consumes Tasks 5–7 routes. Helper `fire(n, fn:(i)=>Promise<Response>): Promise<Response[]>` releases all requests on one tick through an undici Agent with `connections: 64`.

- [ ] **Step 1: Write tests** (each repeated 5 rounds, fresh team per round, asserts exactly one 200, 49 × 409 TEAM_FULL, `member_count = max`, `bw_check_invariants()` empty, exactly one `member.joined` audit row for the round):
  `50 users redeem one code for the last seat`; `50 users hit Join on an open team with one seat`; `leader fires 10 concurrent accepts with one seat`; `one user accepted into two teams at once ends in exactly one`; `one user redeems codes for 5 teams at once ends in exactly one`; `all 4 members leave at once → team deleted once, 4 × 200`.
- [ ] **Step 2: Run** `pnpm -F @bw/api test race` → expect PASS (behaviour from Tasks 5–7). If any fails, debug the protocol, not the test.
- [ ] **Step 3: Commit** `test(api): concurrency race suite`.

### Task 9: Board queries

**Files:** Create `apps/api/src/modules/board/{routes.ts,queries.ts}`; Test `apps/api/test/board.test.ts`

**Interfaces:** Produces `listBoardTeams(sql, hackathonId, q:BoardTeamsQuery, viewer:{offsetMinutes}): Promise<{items:TeamSnapshot[]; nextCursor:string|null; total:number}>`, `listBoardPeople(...)` similar with `PersonSnapshot`. Cursor = base64url of `[createdAt, id]` (or `[member_count, createdAt, id]` for `sort=filling`).

- [ ] **Step 1: Failing tests**: open-seats default hides full and roster-locked teams; `skills=go` returns only teams whose skills or looking_for contain `go`; `tz=3` excludes leader 6 h away; keyset pagination returns disjoint pages covering all; `limit=51` → 400; people board lists only solo, looking participants.
- [ ] **Step 2–5:** FAIL → implement single-statement queries (lateral member aggregate) → PASS → commit `feat(api): keyset board for teams and people`.

### Task 10: Suggestions

**Files:** Create `apps/api/src/modules/suggestions/{scoring.ts,routes.ts}`; Test `apps/api/test/suggestions.test.ts`, `apps/api/test/scoring.test.ts`

**Interfaces:** Produces `scoreCandidate(p:{have:string[]; want:string[]; members:WorkWindow[]}, c:{skills:string[]; window:WorkWindow}): {score:number; components:Component[]; matchedSkills:string[]; newRoles:Role[]; overlapHours:number}`; `SCORING = {weights:{complement:50,timezone:30,novelty:20}, overlapCapHours:8, formula:string}`.

- [ ] **Step 1: Failing tests**: complementary candidate (has wanted `figma`, same tz) outscores redundant one (duplicates `react`); weights sum 100 and `sum(points) === score`; zero overlap → timezone points 0; reasons are non-empty strings mentioning skill labels; endpoint returns ≤ `limit`, excludes people already on teams and the viewer; teams endpoint for solo user ranks a team wanting the user's skill first.
- [ ] **Step 2–5:** FAIL → implement TRD §7 → PASS → commit `feat(api): explained teammate suggestions`.

### Task 11: Audit endpoints

**Files:** Create `apps/api/src/modules/audit/routes.ts`; Test in `apps/api/test/audit.test.ts`

- [ ] **Step 1: Failing tests**: team audit lists actions newest-first with actor names and `nextCursor`; organizer can read hackathon audit, participant gets 403; entries for a deleted team remain readable by organizer.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(api): audit log endpoints`.

### Task 12: SSE hub

**Files:** Create `apps/api/src/modules/events/{hub.ts,routes.ts}`; Test `apps/api/test/events.test.ts`

**Interfaces:** Produces `class EventHub { constructor(sql, listenSql, opts:{coalesceMs:number; heartbeatMs:number}); start(): Promise<void>; attach(hackathonId, userId, raw:ServerResponse): void; stop(): Promise<void>; clientCount(): number }`. Frames: `event: hello`, `event: board` (`BoardFrame`), `event: personal`.

- [ ] **Step 1: Failing tests**: `stream sends hello with retry` (`retry: 3000`); after another user joins a team, the subscriber receives a `board` frame whose team snapshot shows `memberCount+1` within 1 s; `board frame lists removed team id` after last member leaves; leader receives `personal` `request.created`; rolled-back command (TEAM_FULL) produces no frame.
- [ ] **Step 2–5:** FAIL → implement TRD §5 → PASS → commit `feat(api): SSE hub over LISTEN/NOTIFY with coalescing`.

### Task 13: Demo personas, Race Arena, metrics

**Files:** Create `apps/api/src/modules/demo/routes.ts`, `apps/api/src/lib/metrics.ts`; Test `apps/api/test/demo.test.ts`

**Interfaces:** Produces `POST /api/demo/race` → `{teamId, attempts:50, winners:1, outcomes:{TEAM_FULL:49}, invariantViolations:0, durationMs}`, using `claimSeat` with 50 bot participants on separate transactions; `GET /metrics`.

- [ ] **Step 1: Failing test**: race endpoint returns exactly 1 winner and 0 violations; `/metrics` contains `bw_join_attempts_total`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(api): race arena and Prometheus metrics`.

### Task 14: Seed, load test, chaos

**Files:** Create `apps/api/scripts/{seed.ts,chaos.ts}`, `loadtest/board.k6.js`, `loadtest/README.md`

- [ ] **Step 1:** `seed.ts --users 10000 --teams 2000` (deterministic PRNG, bulk insert via `unnest`, shared precomputed argon2 hash for password `hackathon`, demo personas, bot users for the arena). Run it; then `SELECT bw_check_invariants()` → 0 rows; counts match.
- [ ] **Step 2:** k6 script: 100 VUs, 60 s, each VU logs in once (`setup()` mints 100 tokens via `/auth/demo`) and loops `GET board/teams` with random skill/tz/sort filters plus page 2; thresholds `http_req_duration{name:board}: p(95)<200`, `checks>0.99`. Run via `docker run grafana/k6`; save the summary to `docs/loadtest/summary.json`.
- [ ] **Step 3:** `chaos.ts`: starts the server on a port, runs 200 workers (redeem/join/leave/accept loops), SIGKILLs at random 1–3 s intervals six times, restarts, then runs invariants, writes `docs/CHAOS.md`, and exits non-zero on any violation.
- [ ] **Step 4: Commit** `feat: seed, k6 load test, chaos test`.

### Task 15: Web foundation (tokens, shell, auth)

**Files:** Create `apps/web/{index.html,vite.config.ts,package.json,tsconfig.json}`, `src/{main.tsx,App.tsx}`, `src/styles/{tokens.css,global.css}`, `src/api/{client.ts,queries.ts}`, `src/components/{Shell,Button,Field,SkillChip,SeatSlots,Toast,LiveRegion}/*`, `src/pages/{Login,Signup}.tsx`

**Interfaces:** Produces `api.request<T>(method, path, body?, opts?:{idempotencyKey?:string}): Promise<T>`, which throws `ApiError{code,status,details}` and retries network/502–504 twice with the same key; `useMe()`; `<Shell>` (rail ≥ 768 px, bottom tab bar below); `<SeatSlots members max pendingCount highlight?>`; `<SkillChip id lit?>`; `announce(message, politeness)`.

- [ ] **Step 1:** Build the tokens and shell from the direction contract. Read `craft-floor.md` first.
- [ ] **Step 2:** Signup/login pages with time-zone auto-detect, skill picker (checkbox group, keyboard accessible), demo persona buttons.
- [ ] **Step 3: Verify** `pnpm -F @bw/web build` succeeds; manual keyboard pass on login.
- [ ] **Step 4: Commit** `feat(web): design tokens, shell, auth`.

### Task 16: Board UI + live

**Files:** Create `src/pages/Board.tsx`, `src/components/{TeamCard,PersonCard,BoardFilters}/*`, `src/live/useHackathonEvents.ts`

- [ ] **Step 1:** Teams/People tabs (Radix Tabs), filters bound to URL search params, keyset "Load more", "N new teams" pill, live frame application by `version`, polite announcements, optimistic Join with rollback toast on TEAM_FULL.
- [ ] **Step 2: Verify** two browser contexts: a join in A updates B's card in < 1 s.
- [ ] **Step 3: Commit** `feat(web): live board`.

### Task 17: Team flows UI

**Files:** Create `src/pages/{MyTeam,TeamView,JoinByCode,CreateTeam}.tsx`, `src/components/{InviteCard,RequestInbox,ActivityLog,MemberList,ConfirmDialog}/*`

- [ ] **Step 1:** Create team form, invite card (copy code/link, regenerate with TTL select), request inbox (accept/decline optimistic), member list (remove/transfer via confirm dialog), roster lock toggle, activity log, leave dialog, `/join/:code` preview + join, request-to-join dialog with message.
- [ ] **Step 2: Verify** a full keyboard-only pass through create → invite → second user joins → leader leaves.
- [ ] **Step 3: Commit** `feat(web): team, invite and request flows`.

### Task 18: Suggestions, profile, Race Arena UI

**Files:** Create `src/pages/{Suggestions,Profile,RaceArena}.tsx`, `src/components/ScoreBreakdown/*`

- [ ] **Step 1:** Suggestions list with stacked score bar (three segments, numeric labels, not colour-only) and reasons; profile edit; Race Arena with 50 seat tokens resolving to 1 winner + 49 bounced, showing the invariant result.
- [ ] **Step 2: Commit** `feat(web): suggestions, profile, race arena`.

### Task 19: Docker, Compose, Render, CI

**Files:** Create `Dockerfile`, `.dockerignore`, full `docker-compose.yml` (db, app, `seed` and `k6` profiles), `render.yaml`, `.github/workflows/ci.yml`

- [ ] **Step 1:** Multi-stage image (build shared → api via tsup → web via vite; runtime `node:22-alpine`, non-root, `HEALTHCHECK`).
- [ ] **Step 2: Verify** `docker compose up --build` → `http://localhost:8080` serves the SPA and `/readyz` returns ok after seeding.
- [ ] **Step 3:** CI jobs `test`, `load` (seed + k6 thresholds + artifact), `chaos`, each with a `postgres:16` service.
- [ ] **Step 4: Commit** `ci: docker, compose, render blueprint, GitHub Actions`.

### Task 20: Documentation deliverables + design finish

**Files:** Create `docs/design-doc.md` (1 page), `docs/LOADTEST.md`, `docs/CHAOS.md` (generated), `docs/VIDEO_SCRIPT.md`, `README.md`; impeccable finish review; `DESIGN.md` + `.impeccable/design.json` via documenter.

- [ ] **Step 1:** Write the docs from real outputs only (k6 summary, chaos report, test counts).
- [ ] **Step 2:** Capture `.impeccable/review/{desktop,mobile}.png`, run `impeccable detect --json`, spawn the finish reviewer, apply fixes, spawn the documenter.
- [ ] **Step 3: Commit** `docs: design doc, load test report, video script`.
