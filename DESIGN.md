---
name: Bandwagon
description: Live team formation for hackathons. Participants are cards, teams are hands of seats dealt live.
colors:
  shell: "#1f2a7a"
  shell-deep: "#172063"
  shell-hi: "#2b3896"
  on-shell: "#ffffff"
  on-shell-2: "#c9cff7"
  table: "#e9e6df"
  card: "#fcfbf8"
  card-raised: "#ffffff"
  sunk: "#f2f0ea"
  keyline: "#d9d5cb"
  keyline-strong: "#928d80"
  ink: "#161a3a"
  ink-2: "#4a4f72"
  ink-3: "#5d6284"
  danger: "#b3261e"
  danger-tint: "#fbeceb"
  success: "#1d6b45"
  success-tint: "#e7f4ec"
  warn: "#8f5f00"
  warn-tint: "#fdf3dc"
  foil: "#f2b134"
  foil-deep: "#b97f0c"
  live: "#52d6a3"
  role-frontend: "#c23a22"
  role-backend: "#0b7368"
  role-mobile: "#5a3fc8"
  role-design: "#ad2b6f"
  role-data: "#8f5f00"
  role-infra: "#2f7322"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 2.6vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 68"
  headline:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 68"
  title:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 68"
  numeral:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 900
    lineHeight: 0.9
    fontVariation: "'wdth' 62"
    fontFeature: "'tnum'"
  body:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontVariation: "'wdth' 100"
    fontFeature: "'tnum'"
  body-sm:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    fontVariation: "'wdth' 100"
  code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
    fontFeature: "'tnum'"
rounded:
  chip: "5px"
  seat: "6px"
  control: "9px"
  card: "14px"
  sheet: "18px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-8: "32px"
  s-10: "40px"
  s-12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.on-shell}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.shell-hi}"
  button-primary-disabled:
    backgroundColor: "{colors.keyline}"
    textColor: "{colors.ink-2}"
  button-secondary:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.shell}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.danger-tint}"
  input:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
  chip-skill:
    backgroundColor: "{colors.card}"
    textColor: "{colors.role-backend}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0 8px"
    height: "26px"
  chip-skill-lit:
    backgroundColor: "{colors.role-backend}"
    textColor: "{colors.on-shell}"
  badge:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  badge-success:
    backgroundColor: "{colors.success-tint}"
    textColor: "{colors.success}"
  card-team:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  seat-taken:
    backgroundColor: "{colors.role-frontend}"
    textColor: "{colors.on-shell}"
    rounded: "{rounded.seat}"
    height: "60px"
  seat-open:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.seat}"
    height: "60px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.on-shell-2}"
    rounded: "{rounded.control}"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.shell}"
  tab-segment-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card-raised}"
    rounded: "{rounded.control}"
    height: "40px"
---

# Design System: Bandwagon

## Overview

**Creative North Star: "Party Lineup"**

Every participant is a card with a stat block and every team is a hand of seats dealt live. The app is a card table: an ultramarine shell (rail, top bar, tab bar, primary actions) frames a warm binder-grey table, and on that table sit cream card-stock surfaces with a thin keyline. Six skill-type colours are the only saturated hues on card stock, and they appear only where a skill is shown: a chip, a filled seat, a person's plate. One amber foil marks you.

The register is Operate. People come here to complete a task in a land-grab moment, mostly on phones, often by keyboard. The world lends type, palette, density and one signature move (the deal); navigation, forms and dialogs stay standard web controls. Density is medium-high: the board fits a three-up grid of team cards plus a suggestions column at 1440px, and every card carries name, pitch, seats, skills, seats-left and an action without scrolling inside itself.

Seat state is printed, not tinted. Open seats are dashed outlines, a pending claim is hatched, a taken seat is a filled mini-card, your seat has a foil edge, a full team takes a rotated stamp. Each mark reads in greyscale.

**Key Characteristics:**
- Ultramarine shell over a warm grey table; cream card stock with a 1px keyline.
- Six skill-type colours, each 4.5:1 with white text and as text on card stock.
- Amber foil is the "you" colour.
- Archivo variable on its width axis: condensed heavy for names and numerals, normal width for UI.
- Seat states as printed marks (outline, hatch, fill, foil edge, stamp).
- One signature motion, the deal, decelerating on ease-out-quint, with a reduced-motion fallback.

## Colors

A cool ultramarine frame, warm neutral paper, and a strict six-colour skill code, with a single amber accent held back for the viewer.

### Primary
- **Deep Ultramarine Shell** (shell): the rail, phone top bar and tab bar, primary buttons, links, focus rings on light surfaces, the active nav text, the score numeral. White on it measures 12.6:1; the secondary rail text (on-shell-2) 8.2:1.
- **Shell Highlight** (shell-hi): hover fill for primary buttons and rail links (white on it 10.0:1).
- **Shell Deep** (shell-deep): the darkest shell step, for pressed or layered shell areas.

### Secondary
- **Amber Foil** (foil): the viewer's own card edge in the rail, your seat's ring, the active-tab bar on the phone tab bar, focus rings on the shell, the hot count badge, text selection, the skip link, your team's invite code on the shell ticket. Ink on foil is 8.9:1; foil on shell is 6.6:1.
- **Foil Deep** (foil-deep): the inset edge of a pending (hatched) claim and a racing arena token. Never text (3.3:1 on card).

### Tertiary: skill types
Each skill-type colour is used only where a skill is shown. Measured against white text / card stock:
- **Brick Coral** (role-frontend): frontend. 5.4:1 / 5.2:1.
- **Deep Teal** (role-backend): backend. 5.7:1 / 5.5:1.
- **Violet** (role-mobile): mobile. 7.1:1 / 6.8:1.
- **Magenta** (role-design): design. 6.3:1 / 6.1:1.
- **Ochre** (role-data): data. 5.5:1 / 5.3:1.
- **Field Green** (role-infra): infra. 5.8:1 / 5.6:1.

Frontend (4.3:1) and data (4.4:1) drop below 4.5:1 directly on the table ground, so skill text always sits on card stock.

### Neutral
- **Binder-Grey Table** (table): the page ground behind everything.
- **Card Stock** (card): cards, panels, the active rail link, the segmented tab track.
- **Bright Stock** (card-raised): inputs and secondary/danger button fills.
- **Sunk** (sunk): neutral badges, quiet-button hover, disabled secondary fill, track backgrounds.
- **Keyline** (keyline): the 1px card border and dividers.
- **Strong Keyline** (keyline-strong): input borders and open-seat dashes (3.2:1 on card, meeting non-text contrast).
- **Ink** (ink): headings and primary text (16.3:1 on card).
- **Ink 2** (ink-2): body copy, pitches, secondary text (7.7:1).
- **Ink 3** (ink-3): meta, hints, timestamps, collector numbers (5.7:1 on card, 4.8:1 on table).
- **Status** (danger, success, warn and their tints): badges and error notes only. Each tone measures at least 5.0:1 on its own tint.

### Named Rules
**The Skill Code Rule.** The six skill-type colours mean a skill and nothing else. They appear on skill chips, filter toggles, filled seats and a person's plate. They never decorate headings, buttons or charts.

**The Foil Is You Rule.** On card stock, amber foil marks only the viewer: your card, your seat, your pending claim. On the shell it is the attention accent (focus ring, active tab, hot count, your invite code). It never marks another person or another team; the arena winner gets a shell keyline because the winner is not you.

**The Card Stock Rule.** Coloured text lives on card stock, never directly on the table ground.

## Typography

**Display Font:** Archivo Variable (with Archivo, ui-sans-serif, system-ui)
**Body Font:** Archivo Variable at normal width
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace)

**Character:** One family, two widths. Condensed heavy Archivo (wdth 68 for headings, 62 for numerals, seat initials and plates) gives names the punch of a card title; normal-width Archivo keeps controls and body copy plain and legible. Tabular figures are on by default everywhere, so counts and scores never jitter when they tick.

### Hierarchy
- **Display** (800, clamp 2.25rem to 3.25rem, 0.95, wdth 68): the one page title per route ("Looking for teammates").
- **Headline** (800, 1.75rem, 0.98, wdth 68): team card names, empty-state titles, modal titles.
- **Title** (800, 1.375rem, 1.05, wdth 68): panel titles, person card names.
- **Numeral** (900, 2.25rem, 0.9, wdth 62): match scores; the same face at 1.125rem to 1.75rem for seat initials and person plates.
- **Body** (400, 1rem, 1.5): running copy; ledes capped at 62ch, empty-state bodies at 46ch.
- **Body small** (400, 0.875rem, 1.4): pitches (clamped to two lines), bios, card meta.
- **Label** (700, 0.75rem to 0.875rem): buttons, chips, badges, form labels, nav. Sentence case, no tracking.
- **Code** (JetBrains Mono, 500 to 700): invite codes and collector numbers ("No. 0401 / 2,000") only.

### Named Rules
**The Two Widths Rule.** Condensed is for names and numerals; everything you read or press is normal width.

**The Mono Means Code Rule.** JetBrains Mono appears only on invite codes and collector numbers, never as a stylistic label face.

## Layout

A 4px spacing base (4, 8, 12, 16, 20, 24, 32, 40, 48). Page content caps at 1320px (880px for narrow forms) inside a fluid gutter of clamp(16px, 2.4vw, 32px).

- **Shell.** At 768px and up a 232px sticky ultramarine rail holds the wordmark, event name, nav with counts, the live indicator and your card pinned to the bottom. Below 768px the rail becomes a sticky top bar (wordmark, event, live dot) plus a fixed 64px five-tab bottom bar, with main padding clearing it and safe-area insets honoured.
- **Board.** A main column plus a 340px aside ("good fits"). The card grid is auto-fill with a 236px minimum, which lands three-up at 1440px with the aside open. Below 1200px the aside drops under the grid.
- **Whole-card reflow.** Cards reflow as whole units; content inside a card never reflows into side-by-side columns or truncates actions. Below 768px the skill filter row becomes one horizontally scrolling line with snap.
- **Team page.** Hand panel and roster side by side (1.45fr / min 300px) above 1000px; single column below.
- **Live state** sits in the rail on desktop and the top bar on phone, so it is visible on every route.

## Elevation & Depth

Depth is low and tinted from the ink (rgba of #161a3a), never neutral black. Cards rest at lift-1 and rise to lift-2 on hover; dialogs and sheets use lift-3. The primary button carries a small shell-tinted drop and an inset top highlight. Rings, made with spread box-shadows, mark identity: the foil double ring around your card and seat.

### Shadow Vocabulary
- **Lift 1** (`box-shadow: 0 1px 0 rgba(22,26,58,0.04), 0 1px 2px rgba(22,26,58,0.06)`): cards and panels at rest.
- **Lift 2** (`box-shadow: 0 2px 4px rgba(22,26,58,0.06), 0 8px 20px -6px rgba(22,26,58,0.14)`): card hover.
- **Lift 3** (`box-shadow: 0 6px 12px rgba(22,26,58,0.08), 0 24px 48px -12px rgba(22,26,58,0.28)`): modal dialogs and bottom sheets.
- **Foil ring** (`box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--foil)`): your seat; on the rail the inner ring is shell.

### Named Rules
**The Soft Table Rule.** Shadows are offset plus blur and ink-tinted. No hard offset shadows.

## Shapes

Corners get softer as objects get bigger: chips 5px, seats 6px (10px in the large team-page hand), controls 9px, cards 14px, sheets 18px. Full pills are reserved for status badges and counts. Borders are 1px keylines on cards and 1.5px on controls, chips and seat outlines. Dashed strokes mean "empty or wanted": open seats, wanted-skill chips, the ticket tear line, the open seat in the wordmark mark. Diagonal hatching means "pending".

## Components

### Buttons
Solid and quiet; one press does one thing.
- **Shape:** control radius (9px), 1.5px border, minimum height 44px (36px small, 52px large).
- **Primary:** shell fill, white label, 700 weight at 0.875rem; hover to shell-hi; pressed nudges down 1px.
- **Secondary:** bright stock with a shell border and shell label; hover to a pale shell wash.
- **Quiet:** transparent, ink-2 label; hover to sunk.
- **Danger:** bright stock, danger label and a half-strength danger border; hover to danger-tint.
- **Busy:** a spinner takes the icon slot, the label stays, and the button is disabled with `aria-busy`.
- **Motion:** 140ms ease-out on colour, border, shadow and transform.

### Chips
- **Skill chip:** 26px tall, chip radius, label type in the skill colour on a 7% tint of it over card stock with a 38% border.
- **Wanted:** dashed border, transparent fill, prefixed "+".
- **Lit (filter match):** solid skill colour with white text. **Dim (non-match):** keyline border, transparent fill, text contrast unchanged.
- **Filter toggle:** 36px, same language, `aria-pressed` fills it solid.

### Badges
24px pills: neutral (sunk / ink-2), success, warn, danger and shell tones, each tone on its own tint. Used for status ("Your team", "Requested", "Full").

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** card stock with a 1px keyline.
- **Shadow Strategy:** lift-1 at rest, lift-2 on hover; focus-within turns the border shell.
- **Internal Padding:** 16px (panels 20px).
- **Team card:** policy and timezone meta row, condensed name as the whole-card link, two-line pitch, seat slots, skills, then a foot with seats-left and the mono collector number on the left and the single action on the right. A full team carries a rotated "Full hand" stamp. A disbanded team drops to 55% opacity.
- **Person card:** a 52 by 64px plate in the person's primary skill colour with condensed initials, name, timezone, bio, skills, a two-up stat list, and the action at the foot.

### Inputs / Fields
- **Style:** bright stock, 1.5px strong-keyline border, 9px radius, 44px minimum, 16px text (no iOS zoom).
- **Focus:** shell border plus a 3px shell ring at 22%.
- **Error:** danger border, a bold danger message under the field; form-level errors use a danger-tint note.
- **Select:** native select with an inline chevron.

### Navigation
- **Rail:** shell ground; links 44px, on-shell-2 at 700 weight with a count pill; hover to shell-hi; the active link becomes card stock with shell text. A hot count (requests waiting) is foil.
- **Your card:** pinned to the rail foot on card stock inside a shell and foil double ring.
- **Phone tab bar:** fixed shell bar, five tabs at 64px, the active tab marked by a 3px foil bar on its top edge as well as its brighter label.
- **Segmented tabs** (Teams / People): card-stock track, active segment ink with white text.

### Seat Slots (signature)
The hand of seats is the system's signature. Every state reads without colour:
- **Open:** dashed 1.5px strong-keyline outline, the word "Open".
- **Claiming:** a hatched foil-tint stripe with a foil-deep inset edge, while the server referees.
- **Taken:** a mini-card filled in the member's skill colour, condensed initials, a crown for the leader, the skill tag below.
- **Yours:** the foil double ring around whichever seat is yours.
- **Rejected:** your optimistic card shakes, then drops and fades out (650ms), and the reason is announced.
- **The deal:** a seat that fills live arrives from above with a slight tilt and settles (420ms, ease-out-quint `cubic-bezier(0.22, 1, 0.36, 1)`); the seats-left count ticks with it.
- **Reduced motion:** the deal and claim become a 200ms crossfade, the rejection a 400ms fade-out.
- **Sizes:** compact (60px, one row per card) and large (auto-fit 150px minimum, 128px tall, for the team page).

### Score Breakdown
A 0.9 line-height condensed numeral in shell, then an 8px segmented bar whose parts carry stripe patterns as well as colour, then a legend with points and a plain-language reason per part.

### Dialogs
Centred card-stock dialog (max 480px, 18px radius, lift-3) over a 48% ink scrim; below 768px it becomes a bottom sheet with safe-area padding.

## Do's and Don'ts

### Do:
- **Do** put skill colour only where a skill is shown, and always on card stock.
- **Do** mark state with a printed mark (outline, hatch, fill, ring, stamp, pattern) and a text label, so it reads in greyscale.
- **Do** keep every touch target at 44px or more and every control a standard web control.
- **Do** use condensed Archivo (wdth 62 to 68) for names and numerals and normal width for everything else, with tabular figures.
- **Do** use the foil ring for the viewer, and a shell treatment for anyone else who wins or leads.
- **Do** pair every motion with a reduced-motion fallback that keeps the state change visible.
- **Do** show focus with a 2.5px shell outline on light surfaces and a foil outline on the shell.

### Don't:
- **Don't** set eyebrows or kickers above headings; collector numbers sit at the card foot or in a panel header.
- **Don't** use gradient text.
- **Don't** use amber foil to mark another person, another team, or decoration on card stock.
- **Don't** communicate state by colour alone.
- **Don't** use JetBrains Mono for anything but invite codes and collector numbers.
- **Don't** use hard offset shadows or neutral-black shadows.
- **Don't** reflow the inside of a card into columns; reflow whole cards.
