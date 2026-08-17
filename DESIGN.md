# DESIGN.md — "Tartan"

The visual world of 42195, recorded from the built app. Product truth lives in
`PRODUCT.md`.

## Thesis

A training log that reads like a coach's notebook, not a dashboard. It refuses
the metric-tile grid every fitness app ships and leads with the one thing the
runner opened the app to check.

The world is the running track at the end of the day: a warm clay ground (the
tartan surface), chalk-white surfaces you read data on, one ember accent that
only ever means *act on this* or *this is where you are*, and measurements set
in mono on a shared baseline.

## Colour

Strategy: **Restrained**. Warm neutrals carry the page. The ember carries action
and selection. The semantic trio carries state. Nothing is coloured for
decoration.

The ground is deliberately tinted, not an off-white: light mode sits at
`oklch(0.88 0.014 68)` — a clay greige — so chalk-white cards genuinely lift off
it rather than floating on a shadow alone. Dark mode is a warm espresso, never a
neutral black.

The accent keeps the same hue family across themes. It gets lighter in the dark
theme, not different.

| Role | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.88 0.014 68)` | `oklch(0.185 0.012 55)` |
| `--surface-sunken` | `oklch(0.845 0.016 68)` | `oklch(0.15 0.01 55)` |
| `--card` / `--popover` | `oklch(0.985 0.006 72)` | `oklch(0.255 0.014 58)` |
| `--foreground` | `oklch(0.235 0.02 45)` | `oklch(0.945 0.008 75)` |
| `--muted-foreground` | `oklch(0.455 0.024 50)` | `oklch(0.735 0.018 60)` |
| `--primary` | `oklch(0.472 0.163 36)` | `oklch(0.715 0.15 42)` |
| `--primary-foreground` | `oklch(0.985 0.012 70)` | `oklch(0.19 0.03 40)` |
| `--secondary` / `--muted` | `oklch(0.845 0.016 68)` | `oklch(0.305 0.014 58)` |
| `--accent` | `oklch(0.815 0.02 66)` | `oklch(0.345 0.016 58)` |
| `--border` / `--input` | `oklch(0.795 0.016 66)` | `oklch(0.345 0.014 58)` |
| `--success` | `oklch(0.441 0.11 150)` | `oklch(0.76 0.13 150)` |
| `--warning` | `oklch(0.458 0.099 72)` | `oklch(0.8 0.13 75)` |
| `--destructive` | `oklch(0.475 0.18 27)` | `oklch(0.68 0.17 27)` |

Data series (`--chart-1` … `--chart-5`) are separated by lightness as well as
hue, so the set survives greyscale and common colour-vision deficiencies:

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `oklch(0.56 0.165 38)` | `oklch(0.73 0.15 42)` |
| `--chart-2` | `oklch(0.52 0.095 150)` | `oklch(0.74 0.11 152)` |
| `--chart-3` | `oklch(0.6 0.13 72)` | `oklch(0.8 0.12 75)` |
| `--chart-4` | `oklch(0.47 0.07 235)` | `oklch(0.69 0.09 235)` |
| `--chart-5` | `oklch(0.56 0.12 340)` | `oklch(0.72 0.12 340)` |

Rules:

- Text and placeholders clear 4.5:1 against every surface they sit on — the page
  ground, a sunken well and a card alike — in both themes. The sunken well is the
  binding case in light mode and is what sets the lightness of the ember and the
  semantic trio; each clears it by a small margin (4.55–4.56:1) rather than
  comfortably, so lightening any of them re-breaks AA.
- Colour is never the only cue. Load status carries a labelled pill; a completed
  goal carries a trophy; a filter chip carries `aria-pressed`.
- No literal Tailwind palette colours (`amber-500`, `violet-500`, …) anywhere in
  app code. Semantic tokens or chart tokens only. The single exception is
  Strava's brand orange in `components/strava-brand.tsx`.

## Typography

One family. **Figtree** carries headings, buttons, labels and body.
**JetBrains Mono** is reserved for measurements — paces, splits, distances,
clock times, HR values — applied through the `.measure` class, never as a
"technical" costume.

Fixed rem steps, not fluid. The functional floor is 12px; nothing readable ships
below it.

| Token | Size / line-height | Role |
|---|---|---|
| `text-micro` | 12px / 17.6px | metadata, units, pill and chip text |
| `text-label` | 13px / 19.2px | labels, buttons, list rows, section headings |
| `text-body` | 15px / 24px | prose and card body |
| `text-lead` | 17px / 24.8px | screen titles, card titles |
| `text-title` | 20px / 26.4px | stat values, subsection titles |
| `text-screen` | 28px / 32.8px | page headline (auth, privacy, errors) |
| `text-display` | 38px / 40px | the one dominant number on a screen |

Body sets `font-variant-numeric: tabular-nums` globally so figures never jitter
between renders. Headings balance (`text-wrap: balance`) and carry −0.018em
tracking (−0.026em at `h1`); the tracking floor is −0.04em.

Form inputs stay at 16px (`text-base`) so iOS does not zoom the viewport on
focus.

## Shape and elevation

Radii: cards `0.875rem` (14px), controls `0.625rem` (10px), `radius-sm` 6px for
focus rings and inline targets. Pills (`rounded-full`) are for small controls
only — chips, status markers, segmented toggles.

**One elevation system, declared once.** A surface gets a shadow *or* a border,
never both:

- Light mode: `.surface` casts `--elevation-1` (offset + soft blur, tinted from
  the ground's hue). No border.
- Dark mode: shadows read as nothing, so `.surface` swaps to a lit top edge plus
  a 1px hairline (`--elevation-edge`) and the shadow goes to `none`.

Cards never nest. A group inside a card is expressed with a divider, a heading,
or a sunken well (`AppCard variant="quiet"` / `bg-surface-sunken`) — never a
second card.

State on a card is a 1px tone ring (`ring-primary/40`, `ring-success/40`,
`ring-warning/40`), which reads as a state hint rather than a second border.

## Space and rhythm

A 4-unit base. Screens stack sections with `gap-5` to `gap-7`; a section's
heading sits `gap-2.5` from its own content, so there is always more room above
a heading than below it. Screen gutters are `px-4`; card padding is
`p-3.5`/`p-4`/`p-5`; list rows own `px-4 py-3.5`.

Touch targets are 44px minimum (`Button` sizes `md`/`lg`/`icon`); `sm` and
`icon-sm` are only used inside a row that already has its own 44px hit area.

Prose is capped at 46ch inside cards and 68ch on the privacy page. Data rows may
run denser.

## Components

`components/ui` holds the vocabulary. Every screen composes from it; no screen
hand-rolls a button, an input or a card.

| Component | Purpose |
|---|---|
| `AppCard` / `CardRow` | the only card surface; `plain`, `rows`, `quiet` |
| `Section` / `SectionHeader` / `SectionAction` | the page's spacing rhythm |
| `Stat` / `StatGroup` | measurements in a hairline-divided instrument row |
| `Meter` | progress against a target; animates `transform`, never `width` |
| `Pill` | one shape for every status marker |
| `EmptyState` | teaches the surface; icon inline with the title, never above it |
| `Button` | one shape, one press response, every state incl. `loading` |
| `Input` | a sunken well, 16px text, accent caret |
| `BottomSheet` | the one editing surface, on the dialog primitive |
| `PromptDialog` | a small centred window that asks one thing and leaves |
| `ProgressLap` | the mark filled to a value; the single authored motion moment |
| `AppBar` / `TabBar` | the persistent chrome |
| `AuthShell` / `AuthError` / `Field` | the signed-out frame |
| `TrackMark` / `TrackLoader` | the app's mark, still and running |

Every interactive component ships default, hover, focus-visible, active,
disabled and (where it can wait) loading. Loading states are skeletons in the
shape of the content, not a spinner in the middle of empty space.

## Motion

- `--dur-tap` 110ms, `--dur-state` 180ms, `--dur-view` 280ms.
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`. No bounce, no elastic.
- One press response for everything tappable: `.press` scales to 0.985.
- **The authored moment** is `ProgressLap` drawing its arc from zero on first
  mount — the lap filling in. It happens once per mount, only on the meters that
  carry a screen's headline state.
- **Waiting** is `TrackLoader`: the app icon's lead arc running its lane, one
  lap per `--dur-lap` (1500ms), drawn in `currentColor` so it takes the tone of
  whatever it sits in. It marks a wait *inside* something the runner pressed —
  a button, the sync indicator, the coach's reply. A screen that is still
  loading shows the shape of what is coming, never this.
  It runs **anticlockwise**, because a track is run with the inside kerb on
  your left, and the mark is a track. Every runner who uses this app knows
  which way round a lane goes.

**One lane, three states.** The mark, the loader and the progress meter are the
same drawing at the same proportions: `TrackMark` is it at rest, `TrackLoader`
is it running, `ProgressLap` is it run as far as the value. All three go round
the same way, from the same start line. A dial, a bar or a ring anywhere in the
app would be a second vocabulary for something this one already says.
  The hand-off after signing in is the one screen-level wait, and it runs
  `TrackMark running`. It earns that by staying on the same document: a browser
  stops rendering a page it is replacing, so the same lap on the way out of a
  full page load freezes on its first frame for the length of the load. A
  loader is only honest on a document that is still alive.
  The keyframe starts at the offset the still mark is drawn at, so anything
  that does stop it — reduced motion, a page on its way out — lands on the mark
  rather than on a spinner caught mid-stride.
- Nothing animates `width`, `height`, `padding` or `margin`.
- `prefers-reduced-motion` removes travel and keeps feedback. It overrides
  `transition-property` to the colour, border, shadow and opacity set, so
  `transform` stops transitioning — the lap never draws and a meter's fill
  arrives at its value instead of running there — while the properties that
  carry meaning still cross-fade at `--dur-reduced` (80ms), fast enough not to
  read as movement. The press travel is removed and the loader settles on its
  first frame, which is the mark exactly as the icon draws it. Durations are not
  collapsed to zero: that would take the feedback along with the motion.

## Browser surfaces

Themed from the palette, not left to the browser: text selection, the caret,
scrollbar track and thumb, the focus ring (2px `--ring` at 2px offset),
underline offset, and `::marker`.

## Chrome

The app bar is opaque, not translucent — a blurred bar over scrolling content
fails contrast against whatever passes beneath it. Same for the tab bar.

Neither bar draws a rule at rest. A permanent hairline top and bottom cuts a
phone screen into three boxes, and on a screen that fits without scrolling it
separates the chrome from nothing at all. Instead both bars carry a short scrim
— the ground's own colour fading out over the content — so the edge is a
dissolve rather than a line: 1rem below the app bar, 1.25rem above the tab bar.
The ramp fades to a transparent version of the ground rather than to
`transparent`, which would interpolate through rgba(0,0,0,0) and grey its
middle.

Separation is earned. The app bar takes elevation only while the page is
actually scrolled beneath it (`data-raised`), on the same system cards use: a
shadow in light, a lit edge in dark. The tab bar always has content passing
under it, so its scrim is enough.

Four tabs: Today · Activities · Plan · Insights. Profile lives in the app bar.
The active tab is marked twice — an ember lane above the icon and a weight
change — so the state does not depend on colour alone.

Detail views (activity, goal) reuse `AppBar` with a back button instead of
growing a header of their own.

## Refused

Category defaults this world does not use:

- Cream or beige as the page ground.
- Cards nested inside cards; a stack of one-card-per-row lists.
- A hairline border under a wide diffuse shadow (the ghost card).
- Glass or backdrop blur as decoration. A modal scrim is the exception and the
  only one: the page behind a prompt has stopped being content, and putting it
  out of focus is what says so. It sits on top of the dark scrim rather than
  instead of it, so contrast never rests on the blur.
- Icon tiles stacked above headings.
- Coloured side stripes on cards, callouts or alerts.
- Gradient text; glow shadows; radial background halos.
- Any text below 12px.
- Uppercase tracked micro-labels as section headings.
- A modal where an inline confirmation would do — destructive actions confirm on
  the row they belong to.
