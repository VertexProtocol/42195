# 42195 — Design system

Direction: **warm athletic**. An evolution of the existing warm palette, not a
replacement for it. The app should still feel like itself; it should just stop
fighting itself.

This document covers the rules. The values live in `app/globals.css`, which is
the single source of truth — nothing here restates a number you would have to
keep in sync.

---

## What was wrong

Four of these are measurable defects, not matters of taste.

| | Problem | Evidence |
|---|---|---|
| 1 | **The brand changed colour between themes.** Light mode was red-orange (hue 30), dark mode was yellow-amber (hue 85). | Two different identities depending on the time of day. |
| 2 | **White text on primary buttons failed WCAG AA.** | 3.73:1, against a 4.5:1 requirement. |
| 3 | **`--warning` was unreadable as text.** | 2.28:1 on a card. |
| 4 | **Warm surfaces, neutral text.** `--background` carried warmth (hue 85) while `--foreground` and `--muted-foreground` had zero chroma. | Mixing a warm surface with a dead-neutral grey is what made the palette read muddy. |
| 5 | **No elevation scale.** Every card was `shadow-sm ring-1 ring-border`. | Nothing could recede or advance; a hero goal and a stat tile carried identical weight. |
| 6 | **No reduced-motion handling.** | Every ring sweep, carousel and spinner ignored the OS accessibility preference. |

---

## The rules

### 1. One brand hue

Hue 32 in light, 42 in dark. The small drift is deliberate — a colour needs
slightly more warmth to read as the same colour against a dark field — but it
is far inside the range that still reads as one brand.

### 2. Neutrals stay warm all the way down

Every grey carries a little chroma on the same warm axis as the surfaces. This
is the single change that does the most work: it is why the palette now reads
as *paper and ink* rather than *beige with grey text on it*.

### 3. Every text pair meets WCAG AA

Verified numerically rather than by eye. Contrast for each pair is recorded in
the header comment of `app/globals.css`. Re-derive it before changing any
colour value; the eye is not reliable at 4.5:1.

### 4. Fill ≠ text

A colour bright enough to be a good fill is rarely dark enough to be readable
text. `--warning` fills, `--warning-accent` is its readable-on-surface twin.
The same logic drove the activity badges: the chart palette is tuned for
*marks*, which WCAG holds to 3:1, and two of the five land at ~3.9:1 when set
as 10px text. Colour moved to a dot; the label runs neutral at 16:1.

### 5. Borders come in two weights

`--border` is a decorative hairline. `--border-strong` clears the 3:1 that
WCAG 1.4.11 requires of controls whose boundary carries meaning — inputs,
checkboxes, anything you can type into.

### 6. One press, everywhere

`.press` in `globals.css` is the only touch feedback in the app. A card, a
list row and a tab all depress identically because they all use it.

---

## Primitives

Reach for these before writing a bespoke arrangement. Most of what makes a
long scrolling screen feel composed rather than assembled is that its sections
share a rhythm.

| Component | Use for |
|---|---|
| `AppCard` | Every card surface. `variant` × `elevation` × `state`. |
| `Metric` / `MetricRow` | Every number the user reads. Tabular value, separate unit, micro-caps label. |
| `SectionHeader` | The label above any group of content. |
| `Sparkline` | A bar per day. Zero days draw a stub — a rest day is information. |
| `ProgressRing` | Circular progress. Renders its own centred content via `children`. |

### Composition notes

**Three stat cards in a row is three borders, three shadows and three fills to
say one thing.** `MetricRow` says it with hairlines inside one card, at a
quarter of the ink. This is why the Home week summary is one card now.

**A badge that never varies is decoration, not information.** In a running app
"Run" is the default, so the type badge only appears on activities that are
not a plain run. `Race` is the exception worth interrupting a scan for, and
gets a filled brand pill.

**Pick one visual anchor per card.** The goal card leads with days remaining —
the number that changes what you do tomorrow — and carries block progress on a
linear bar. A 64px ring with 10px text inside it next to three other figures
is two anchors competing.

---

## Bugs fixed along the way

- **`ProgressRing` centring.** The content overlay was `absolute` inside a
  container that was never `relative`, so it escaped to whatever positioned
  ancestor happened to be nearby. Every call site worked around it by wrapping
  the ring and repeating the centring markup. It now renders its own children.
- **`ProgressRing` NaN guard.** A divide-by-zero upstream produced an invalid
  `stroke-dashoffset` and blanked the ring entirely.
- **Date labels drifting a day.** `new Date("2026-07-28")` parses as UTC
  midnight, which renders as the 27th anywhere west of Greenwich.
  `lib/date-labels.ts` normalises to local noon; `lib/date-labels.test.ts`
  covers it.
- **Untranslated strings** on the training-load card ("Training Load", "Low",
  "Optimal", "High", "Fitness") and two missing `ø` in the Norwegian
  translations.

---

## Known gaps

Deliberately out of scope for this proposal, and worth their own pass:

- **`lib/format.ts` hardcodes `en-US`** for `formatDate`, `formatDateShort` and
  `formatTimeAgo`. New screens use `lib/date-labels.ts` instead, so Home and
  Activities are locale-correct — Goals, Insights and Activity Detail are not
  yet.
- **Goals, Insights, Profile and Activity Detail** inherit the new tokens and
  therefore the new palette, but their layouts have not been reworked.
- **`components/training-load-indicator.tsx`** still uses hardcoded
  `amber-*` / `red-*` Tailwind palette classes rather than semantic tokens.
- **ESLint does not run.** `npm run lint` fails with "couldn't find an
  eslint.config.js" — pre-existing, unrelated to this change.
