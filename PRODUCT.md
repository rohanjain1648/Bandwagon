# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: the user handed the stack to Claude ("fully ideate … implement fully"). Chosen: TypeScript monorepo; Fastify + PostgreSQL API with correctness enforced in SQL; Server-Sent Events for live updates; React + Vite SPA served by the same origin; Vitest, k6, GitHub Actions; one Docker image deployed to Render (free web service) with Neon (free Postgres). Rationale lives in docs/TRD.md.

## Users

- **Participants** (primary, ~10,000 per hackathon): students and early-career builders in the days and hours before a hackathon starts, usually on a phone between other things, trying to get into a good team before seats run out. Job: find people whose skills complement theirs, in a workable time zone, and lock in a seat.
- **Team leaders**: the participant who created a team. Job: share an invite code, triage join requests, accept or decline quickly, and keep the team within the size rules.
- **Organizers** (secondary): need to trust that the rules held (no one in two teams, no oversized teams) and to see who changed what, when.
- **Evaluators of this submission** (situational): hackathon judges who will open the live URL, read the repo, and try to break concurrency. Demo affordances must make the flow testable in under a minute.

## Product Purpose

Bandwagon is the team-formation layer for a large hackathon: teams with invite codes, join requests the leader accepts or declines, and a live "looking for teammates" board. It exists because team formation is a land-grab moment: hundreds of people act in the same second, and any double-booking, phantom seat, or stale board destroys trust. Success means every participant who wants a team gets one that respects the size rules, nobody ever holds two seats, and the board everyone sees is the truth, live.

## Positioning

Correctness under contention is the product. "Exactly one person gets the last seat" is a guarantee enforced by the database and proven by automated race and chaos tests, not a best-effort UI check. Suggestions explain their own scoring instead of being a black box.

## Operating Context

- Peak usage is bursty: invite codes get pasted into a Discord channel and dozens redeem at once; leaders accept requests from two devices.
- Most participants are on mobile; many navigate with a keyboard or assistive tech.
- Network is often flaky (venue Wi-Fi, mobile data): retries and double-clicks are normal, not edge cases.
- Participants span many time zones; overlap of working hours matters for remote collaboration.
- The audit log is consulted when someone disputes "who removed me" or "why did my team disappear".

## Capabilities and Constraints

- One team per person per hackathon; team size bounded by a hackathon-defined minimum and maximum (minimum applies to readiness, since teams start with one member).
- Invite codes expire, can be revoked/regenerated, and must resist brute force (high entropy + rate limits).
- Leadership passes on when the leader leaves; the last member leaving deletes the team.
- Only the leader can accept, decline, or remove.
- Every team change is written to an append-only audit log in the same transaction as the change.
- Every mutating request is idempotent under retry.
- Teammate suggestions rank people by complementary skills and time-zone overlap, with the scoring explained.
- Terminology: "hackathon", "team", "leader", "member", "seat", "invite code", "join request", "board", "looking for a team".
- Undecided: real identity provider (email + password for now), organizer admin tooling beyond the audit view.

## Brand Commitments

- Name: **Bandwagon** (chosen by Claude after the user asked for a funky name; easy to rename).
- Demo hackathon: **Hack4Hack 2026** (from the project folder name).
- Voice: plain, quick, a little playful in empty states and success moments; never cute in errors. Errors say what happened and what to do next.

## Evidence on Hand

- No real users, testimonials, or metrics exist. Demo data comes from a deterministic seed script (10,000 users, 2,000 teams) and must be labelled as demo data.
- Performance and correctness claims must come from the load-test report and test runs in this repo, never invented.

## Product Principles

1. **The database is the referee.** Every rule that matters under contention is enforced where races are decided, and the UI reflects the verdict honestly.
2. **Retries are normal.** Any action can be clicked twice or replayed by the network without changing the outcome.
3. **Live means live.** What one person sees changes within a second of what another person did, with no refresh.
4. **Explain, don't decide.** Suggestions and conflicts come with their reasons.
5. **Fast on a bad phone.** The common path (board → team → request/join) works on a small screen, with a keyboard alone, on slow networks.

## Accessibility & Inclusion

WCAG 2.2 AA is the bar: full keyboard operation with visible focus, screen-reader announcements for live updates (polite) and conflicts (assertive), touch targets ≥ 44px, reduced-motion respected, no information conveyed by color alone.
