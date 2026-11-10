# Bandwagon — Product Requirements

**Status:** v1 (build target for this repo) · **Owner:** solo build · **Demo event:** Hack4Hack 2026

## 1. Problem

At a hackathon with 10,000 participants, team formation is a land-grab. Invite codes get pasted into a Discord channel and dozens of people redeem them in the same second. Leaders accept requests from a laptop and a phone at once. Venue Wi-Fi drops requests and people click twice. A naive app double-books seats, puts one person in two teams, shows a "1 seat left" card that filled a minute ago, and leaves no record of who removed whom.

Bandwagon is a team-formation service that stays correct under that pressure and shows everyone the truth, live.

## 2. Users and jobs

| User | Situation | Job to be done |
|---|---|---|
| Participant (solo) | Days or hours before kickoff, usually on a phone | Find a team whose skills complement mine, in a workable time zone, and get a seat before it's gone |
| Team leader | Created a team, owns the roster | Share an invite code, triage requests, accept/decline fast, keep the team within size rules |
| Member | Already on a team | See who's on the team, leave cleanly, see what changed |
| Organizer | Runs the event | Trust the rules held; answer "who removed me / where did my team go" from an audit trail |
| Judge (situational) | Evaluating this submission | Try the whole flow and the race in under a minute without setting anything up |

## 3. Goals

1. **Correct under contention.** If 50 people go for the last seat in the same instant, exactly one gets it. Nobody is ever on two teams in one hackathon. Team size never exceeds the maximum.
2. **Safe to retry.** A double click, a replayed request, or a client retry never joins twice or creates two teams.
3. **Live.** The board and team pages update for everyone within about a second, with no refresh.
4. **Explainable matching.** Suggestions rank people by complementary skills and time-zone overlap and say why.
5. **Accountable.** Every team change is recorded: who, what, when.
6. **Fast and usable everywhere.** Board p95 under 200 ms with 100 concurrent users. Works on a phone and with a keyboard only.

## 4. Non-goals (v1)

- Project submission, judging, and prizes.
- Chat or messaging between participants (a join request carries one short message).
- SSO and identity providers (email + password, plus demo login).
- Multi-region deployment.
- Native mobile apps (the web app is responsive).

**Anti-goals** (failures even if everything "works"):
- A seat shown as open after it's taken, with no correction arriving.
- An error that blames the user for a race they lost ("Invalid request") instead of saying what happened.
- Scarcity theatre: countdowns and red banners meant to pressure people.

## 5. Rules (business invariants)

| # | Rule | Enforced by |
|---|---|---|
| R1 | Team size is between the hackathon's `min_team_size` and `max_team_size` | Max is a hard DB constraint. Min gates "ready": a leader can't lock the roster below min, and teams below min are flagged "needs N more" |
| R2 | One team per person per hackathon | DB structure: membership is a single nullable `team_id` column on the participant row |
| R3 | Invite codes expire, can be revoked, and can have a use limit | Checked atomically when a code is redeemed |
| R4 | When the leader leaves, leadership passes to the longest-serving member | Same transaction as the leave |
| R5 | When the last member leaves, the team is deleted | Same transaction; the audit log keeps the history |
| R6 | Only the leader can accept, decline, remove, transfer leadership, manage codes, or edit the team | Checked under the team row lock |
| R7 | A participant can have at most 5 pending join requests per hackathon | Checked under the participant row lock |
| R8 | After the formation deadline, joins, creates, and accepts are refused; leaving is still allowed | Every mutation checks it |

## 6. Features and acceptance criteria

### F1. Accounts
- Sign up with email, password (8–128 characters), display name, time zone (auto-detected and editable), working hours, and 1–12 skills from a fixed catalogue.
- Log in and log out. The session is an httpOnly cookie.
- **Demo login** (when demo mode is on): one-click personas, "Leader with one open seat" and "Solo participant", so judges can test without signing up.
- **AC:** bad input gets a 400 with field-level messages. Wrong credentials get a 401 that doesn't reveal whether the email exists. Login is rate-limited.

### F2. Teams
- Create a team with name (unique within the hackathon, case-insensitive), pitch (≤ 280 characters), wanted skills, and join policy: **Open** (anyone with a free seat can join instantly) or **Approval** (requests only).
- The creator becomes leader and first member, and an invite code is generated.
- Team page: seat slots (filled and open), members with skills and local times, a readiness badge (meets the minimum or not), the invite code (leader only), pending requests (leader only), and an activity log (members only).
- The leader can edit details, lock or unlock the roster (lock needs ≥ min members), remove a member, and transfer leadership.
- Anyone can leave. If the leader leaves, leadership passes on (R4). If the last member leaves, the team is deleted (R5).
- **AC:** a stale edit (someone changed the team since you loaded it) gets a 412 conflict with the current state, and the UI rolls back its optimistic change and explains.

### F3. Invite codes
- 12 characters from Crockford base32 (60 bits of entropy), shown as `K7QM-4XHT-9RJP`. Lowercase, dashes, and look-alikes (O/0, I/L/1) are accepted.
- TTL of 1 h, 24 h, 48 h (default) or 7 days, and an optional use limit. Regenerating revokes the old code.
- Shareable link `/join/<code>` previews the team before you join.
- **AC:** an expired or revoked code gets a 410 with a clear message. Rate limits are 10 redemptions per 10 minutes per user and 30 per IP. Five failed attempts lock that user out of redemption for 15 minutes. Brute force is infeasible: with 2,000 live codes in a 2^60 space, 10,000 accounts guessing at the rate limit would need more than 10^4 years to expect one hit.

### F4. Join requests
- Request to join an Approval team with an optional message (≤ 280 characters). One pending request per team; at most 5 pending overall (R7).
- The leader accepts or declines. The requester can cancel. When someone joins any team, all their other pending requests are cancelled automatically.
- **AC:** accepting into a full team gets a 409 TEAM_FULL. Accepting someone who just joined another team gets a 409 ALREADY_IN_TEAM, and their request shows as cancelled. A non-leader gets a 403.

### F5. Live board ("Looking for teammates")
- Two tabs: **Teams with open seats** and **People looking for a team**.
- Search by name, filter by skills (a skill filter highlights matching chips on every card), time zone (within ±N hours of me), and policy (Open/Approval). Sort by newest or almost full. Keyset pagination.
- Updates arrive over Server-Sent Events. Cards change in place (seats fill, teams vanish when full or deleted, new teams appear as "N new teams" so the list doesn't jump while you read). Screen readers hear a polite summary.
- **AC:** a change made by user A appears for user B in under 1 s at p95 on a healthy connection. After a dropped connection, the client reconnects and resyncs automatically.

### F6. Teammate suggestions
- `GET /api/hackathons/:id/suggestions/people` ranks solo participants for my team (or for me, if I'm solo). The score combines complementary skills, time-zone overlap, and skill novelty, and every result carries a breakdown and plain-language reasons.
- Companion `suggestions/teams` ranks open teams for a solo participant.
- **AC:** a candidate who covers the team's missing wanted skills ranks above an otherwise identical candidate who duplicates existing skills. Every result includes its component scores, and the weights add up to 100.

### F7. Audit log
- Append-only (the DB rejects UPDATE and DELETE). Each entry has actor, action, subject, team (name kept as a snapshot), details, request id, and timestamp. It's written in the same transaction as the change.
- Visible to team members (their team) and organizers (the whole hackathon).

### F8. Idempotency
- Every mutating endpoint accepts an `Idempotency-Key` header, and the UI always sends one per user intent and reuses it on automatic retries. A replay returns the original response with `Idempotent-Replayed: true`. Reusing a key with a different body gets a 422.

### F9. Race Arena (demo and proof)
- A demo-mode page where an organizer or judge triggers "50 people grab the last seat". The server fires 50 concurrent join transactions at a fresh team with one seat left and streams the outcome: 1 winner, 49 TEAM_FULL, and the invariant check result.

## 7. UX requirements

- Mobile-first. At widths under 768 px the side rail becomes a bottom tab bar and cards become a single column. Touch targets are ≥ 44 px.
- Keyboard-only: skip link, logical tab order, visible focus, every action reachable, focus moved to the page heading on navigation, dialogs that trap focus and return it on close.
- Accessibility: WCAG 2.2 AA contrast, state never shown by colour alone (seat states have distinct marks), `prefers-reduced-motion` respected, polite live region for board changes, assertive live region for conflicts.
- Optimistic UI: join, request, accept, decline, and leave update immediately and roll back on conflict with a specific explanation ("Someone took the last seat a moment before you").
- Copy is plain and specific. Errors say what happened and what to do next.

## 8. Success metrics (for this submission)

| Metric | Target | Evidence |
|---|---|---|
| Race correctness | 1 winner out of 50, every run | `apps/api/test/race.test.ts` in CI, repeated rounds |
| Idempotency | 0 duplicate effects under concurrent replays | `idempotency.test.ts` |
| Crash safety | 0 invariant violations after repeated SIGKILLs mid-join | `pnpm chaos` report |
| Board latency | p95 < 200 ms at 100 VUs over a 10k-user / 2k-team dataset | `docs/LOADTEST.md`, k6 |
| API tests | ≥ 20, green in GitHub Actions | CI |
| Live latency | < 1 s from commit to other clients | SSE + manual demo in two browsers |

## 9. Deliverables

GitHub repo · live URL (Render + Neon free tiers) · load-test report · 1-page design doc (`docs/design-doc.md`) · walkthrough video script (`docs/VIDEO_SCRIPT.md`) · Docker Compose one-command setup · CI workflow.

## 10. Open questions (decided by default, revisit later)

- Is the minimum team size a hard gate at the deadline? v1: teams below min are flagged, not deleted.
- Should leaving after the deadline be allowed? v1: yes; organizers resolve disputes using the audit log.
