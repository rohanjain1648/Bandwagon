# Walkthrough video: script (≤ 5:00)

Record at 1440×900, two browser windows side by side (A = leader persona, B = solo persona; B can be a phone-width window). Keep the terminal ready for the tests.

| Time | Show | Say (roughly) |
|---|---|---|
| 0:00–0:20 | Sign-in page | "Bandwagon is team formation for a 10,000-person hackathon. The hard part is one moment: hundreds of people going for the last seat at once. Exactly one gets it." |
| 0:20–0:50 | A: *Lead a team with one seat left*. Board: seat hands, skill chips, filters (click Go, ±4 h) | "Every team is a hand of seats. Filled seats are typed by skill, open seats are outlined. Filters live in the URL. This is 2,000 real seeded teams." |
| 0:50–1:30 | A: My team: invite ticket, request inbox, accept one. B (other window) sees the card fill live, no refresh | "Leaders get an invite code and an inbox. When I accept, the seat is dealt in on everyone's board within a second, over server-sent events." |
| 1:30–2:00 | B: try to join a full team / lose a race: card bounces, toast explains | "If you lose a race, the UI says exactly what happened: someone took the last seat a moment before you. The optimistic seat rolls back." |
| 2:00–2:40 | Race arena: Start the race. 50 tokens → 1 winner, 49 turned away, 0 violations. A's board shows the race team appear and fill | "Fifty concurrent transactions, same code path as the Join button. One winner. The invariant check runs on the database right after." |
| 2:40–3:20 | Code: `apps/api/migrations/001_init.sql` (participants.team_id, seats CHECK, trigger), `teams/service.ts` lockTeam + claimSeat | "Two guarantees live in the schema. One team per person is a single nullable column. Capacity is a CHECK constraint. The service locks the team row, re-reads the count, and claims with a conditional update, always in one lock order." |
| 3:20–3:50 | Terminal: `pnpm -F @bw/api test race` (green), then the idempotency test name | "The race suite: 50 users × 5 rounds per scenario, real HTTP, real Postgres. Idempotency keys live inside the transaction, so a double click replays the original response byte-for-byte." |
| 3:50–4:20 | `docs/CHAOS.md` and `docs/LOADTEST.md` | "Chaos: we SIGKILL the server six times mid-join under 120 clients. Zero violations, and the audit log reconciles exactly. It caught one real bug, now a regression test. Load: p95 19.5 ms at 100 users over 10k users and 2k teams." |
| 4:20–4:45 | For you page: score breakdown | "Suggestions rank people by complementary skills, time-zone overlap and novelty. Every score shows its parts and reasons." |
| 4:45–5:00 | Phone width + Tab through the board | "It works on a phone and with a keyboard alone. axe reports zero violations. Repo, CI and live URL are in the README." |
