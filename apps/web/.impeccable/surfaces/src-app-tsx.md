---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src"]
---

# Surface brief: Bandwagon web app (all routes)

## Scope and mode
The whole React SPA (board, team, invite, requests, suggestions, profile, auth, race arena). Mode: **Operate**. Participants complete a task (find a team, take a seat, run a roster). Precision and restraint; the world lends type, palette, density and one signature move only. Navigation and controls stay standard web components.

## Audience, job, constraints
Hackathon participants, mostly on phones, often keyboard-only or using assistive tech, on flaky networks, in a land-grab moment. Leaders triage requests fast. Judges try the race in under a minute. WCAG 2.2 AA, 360 px minimum width, touch targets ≥ 44 px, reduced motion respected, state never by colour alone.

## Direction contract

THESIS: Every participant is a card with a stat block and every team is a hand of seats dealt live. It refuses the category default: a grey grid of avatar cards with an "N open" label.

OWN-WORLD: An ultramarine shell (rail, header, primary actions) over a warm grey table, with card-stock surfaces and a thin keyline. Six skill-type colours (frontend coral, backend teal, design magenta, data amber, mobile violet, infra green) appear only on skill chips and filled seats. An amber foil ring marks your own card. Type: Archivo variable, condensed black for card names and numerals, normal width for UI; JetBrains Mono for codes and collector numbers; tabular figures everywhere. Seat states are printed marks: outlined = open, hatched = pending, filled = taken, foil = yours.

STORY: The visitor sees which teams still have seats, what each needs, and who fits; trusts the board is live; joins or asks in one press; and when they lose a race, sees exactly why.

FIRST VIEWPORT: Desktop. A 232 px ultramarine rail with wordmark, hackathon, nav with counts, and your card at the bottom. The main column has a condensed "Looking for teammates" heading with a live dot and counts, then search plus Teams/People tabs, then skill chips, then a three-column grid of team cards (collector number, name, pitch, seat slots, seats left, primary action at bottom right). A 340 px right column holds "Good fits for you" with scored suggestions. Mobile: a header, a single card column, a bottom tab bar, and suggestions as their own tab.

FORM: Party Lineup (trading cards and party-select screens), position 5 of the ordered list; seed: seed:cb0f58a7b46b8ef7. Signature interaction is "the deal": when a seat fills live, a mini-card deals into the empty slot and the seats-left count ticks. A lost race bounces your optimistic card back out with the reason, and a full hand takes a FULL stamp. Under reduced motion this becomes a crossfade.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- None blocking. The Race Arena visual (50 seat tokens resolving) inherits the deal motion.
