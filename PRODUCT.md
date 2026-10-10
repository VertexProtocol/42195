# PRODUCT.md — 42195

Durable product truth. Design decisions live in `DESIGN.md`.

## What it is

A running training tracker. It pulls activities from Strava (or takes them
entered by hand), measures them against the runner's race goals and weekly
targets, watches training load for injury risk, and answers questions through
an AI coach that has the runner's own history in front of it.

The name is the marathon distance in metres.

## Who uses it

One runner, on a phone, in two moments:

- **Before a run**, deciding what to do today: is the race close, is the week
  behind, is the body handling the load.
- **After a run**, checking that what they just did landed where they expected.

They are amateur runners training for a specific event, comfortable with pace,
splits and heart-rate zones. They already use Strava. They want a number and a
decision, with as little text around it as possible — and a small reward for
showing up: a weekly streak, badges, and a moment of celebration when a week is
won.

A runner can share a race with other runners, and that is the only place anyone
else appears. It is an addition to a goal, never a layer over the app: the
group lives on the goal it belongs to, Today never mentions it, and a runner
who joins none of them sees exactly the app described above. Everyone keeps
their own target time and their own plan — a group owns the race and the date
and nothing else, and what its members see of each other is one number and a
name.

The scene is a phone held in one hand, often outdoors, often in low light early
or late in the day, sometimes immediately after finishing a run. Both light and
dark are real use conditions, so both are designed, not derived.

## Visitor mode

**Operate.** Every screen serves a task. Expression lives in precise details —
the type, the measurements, the spacing — never in anything that gets between
the runner and the number they came for.

`/auth/*` and `/privacy` are the same mode: get in, get the answer, get out.

## Surfaces

| Surface | Job |
|---|---|
| Today | The race countdown, the next run of the plan, training load, the week so far, the weekly targets. The log lives under Runs, not here. |
| Runs | Two halves behind one switch: **Log** (search, filter, open one; grouped by month, ten at a time) and **Insights** (the streak and totals, then a board of tiles — coach, records, predictions, calendar, pace calculator, badges, test runs — each opening on its own). |
| Goals | Race targets and weekly targets; the AI training plan per goal; the group sharing a race, if there is one. A goal without a plan opens on its preferences, one question at a time, and the plan is made at the end of them. |
| Profile | Account, Strava connection, HR calibration, appearance, language. |

Three tabs, no more. Profile is reached from the avatar in the app bar; the
streak flame sits beside it on every main screen.

## Streaks and badges

Derived, never stored (`lib/gamification.ts`). A week is won when every weekly
goal that applied to it was met; a runner with no weekly goals wins a week by
running in it. Badges mark distance milestones (5 km to marathon), lifetime
totals and streak lengths. Winning the week or earning a badge shows one
full-screen celebration, once.

## Language

British-leaning English and Norwegian (Bokmål), switchable in Profile and
persisted to the user's profile row.

Copy is sentence case throughout. Controls name their action ("Sync now", not
"Sync"). Errors name the problem and the recovery ("We could not save that
activity. Check your connection and try again."), never a raw provider message —
auth errors in particular are sanitised so they cannot be used to work out
whether an address is registered.

## Constraints and commitments

- **Strava attribution is mandatory** wherever Strava data is shown, and the
  "Connect with Strava" button keeps Strava's own orange (#FC4C02) and wordmark.
  This is the one place the app's palette does not apply.
- **Measurements are metric**: kilometres, min/km pace, metres of elevation, bpm.
- Mobile-first, one column, max 28rem (`max-w-md`) centred. There is no desktop
  layout; the phone layout is the product, on iOS and Android alike: 360px is
  the narrowest width it is checked at, controls take no double-tap delay or
  long-press selection, the on-screen keyboard resizes the page, and Android's
  pull-to-reload is held off in favour of the app's own pull-to-sync.
- Installable as a PWA, so the chrome must respect safe-area insets top and
  bottom.
- AI features are rate-limited and degrade to a stated error, never to silence.
