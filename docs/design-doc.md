# Bandwagon: design doc (1 page)

**Problem.** In a 10,000-person hackathon, team formation is a land-grab: a code pasted in Discord gets redeemed fifty times in one second. Bandwagon guarantees exactly one person gets the last seat, a retry never double-joins, and every board stays live. Details: [TRD](TRD.md).

## Data model
`users` · `hackathons` (min/max size) · `teams` (`member_count`, `max_size` snapshot, `leader_id`, `version`) · **`participants(hackathon_id, user_id, team_id NULL)`** · `invite_codes` · `join_requests` · `audit_log` (append-only) · `idempotency_keys` · `rate_limits`.

- **One team per person is structural.** Membership is a single nullable `team_id` on the participant row. Two teams for one person can't be represented, so it doesn't need checking.
- **Capacity is a constraint.** A trigger moves `member_count` in the same statement as the membership change, and `CHECK (member_count <= max_size)` rejects any write that would overfill, even from buggy code or raw SQL.
- **Leader ∈ members** is a deferred composite FK. Leaving, leadership hand-off, and the last-member-out delete all happen in one transaction.
- **The audit log** is written in the same transaction as each change. A trigger rejects UPDATE, DELETE and TRUNCATE.

## How races are prevented
1. **One transaction per command, one global lock order:** team row → participant row → request/invite rows. Every multi-row command locks in that order, so lock waits can't cycle. Deadlock and serialization retries remain as a backstop.
2. **Last seat:** `SELECT … FROM teams WHERE id=$1 FOR UPDATE` → re-read `member_count` under the lock → claim with `UPDATE participants SET team_id=$t WHERE … AND team_id IS NULL`. Fifty callers queue on one row for about 1 ms each. The first wins; 49 get a clean `409 TEAM_FULL`. There's no global lock, so 2,000 teams fill in parallel.
3. **Idempotency:** the `Idempotency-Key` row is inserted first, *inside* the command's transaction. A concurrent duplicate blocks on that unique row, then replays the stored response byte-for-byte (stored as `json`, not `jsonb`). A rejected attempt rolls its key back, so retrying is honest.
4. **Live without lies:** `pg_notify` runs inside the transaction, so Postgres delivers it **only on commit**. Each instance LISTENs, coalesces per hackathon every 150 ms, loads fresh snapshots, and pushes SSE frames carrying `version`. Clients apply only newer versions and fully resync after any reconnect.

**Proof.** 86 API tests in CI, including a race suite run as 5 rounds × 50 concurrent HTTP requests over 128 sockets against real Postgres: invite code, open join, 10 parallel accepts, the same person accepted by two leaders, one person grabbing 5 teams, and everyone leaving at once, each asserting exactly one winner and `bw_check_invariants() = ∅`. The **chaos test** SIGKILLs the server 6× under 120 clients: 0 violations, and the audit trail reconciles with every team's `member_count` ([CHAOS.md](CHAOS.md)). It also found a real bug: a join request racing a team's deletion returned 500. The fix was to share-lock the team first. **Load:** p95 **19.5 ms** at 100 VUs over 10k users / 2k teams ([LOADTEST.md](LOADTEST.md)).

## Trade-offs I made
| Choice | Why | Cost |
|---|---|---|
| Row lock + conditional update (READ COMMITTED) over SERIALIZABLE | 49 losers get a 409, not 49 aborts and retries at peak | Lock order must be respected; documented and tested |
| Postgres for rate limits, idempotency and fan-out (no Redis) | One system decides; atomic with the change; nothing to drift | ~1 extra round trip on sensitive routes |
| SSE over WebSockets | Board is one-way; works through proxies; cookies authenticate | Client→server stays plain HTTP |
| Full resync on reconnect instead of gap replay | Audit ids are not commit-ordered; resync is never wrong | One board refetch per reconnect |
| Board JSON built in Postgres | Profiling showed ~40% of CPU in parse/serialize round-trips | Shape duplicated in SQL; pinned by a contract test |
| Stateless JWT cookie | No session lookup on the hot path | Logout can't revoke a stolen token before expiry |
| Min size gates "ready" and roster lock | Teams grow from one, so "≥ min always" is impossible | Not enforced at every instant |
| Free tier (Render 0.1 vCPU + Neon) | Requirement | Cold start about 30 s; load numbers come from CI/local |

## With one more week
Revocable sessions table and SSO; organizer console (deadline enforcement, merges, an audit search UI); outbox table + monotonic sequence for gap-free SSE replay; Redis/Valkey pub-sub option for very large fan-out; OpenTelemetry traces (Prometheus metrics exist today); Playwright e2e of the two-browser live flow in CI; matching that learns from accepted requests; i18n and RTL.
