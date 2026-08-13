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
splits and heart-rate zones. They already use Strava. They are not looking for
motivation graphics; they are looking for a number and a decision.

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
| Today | The race countdown, the next session of the plan, training load, the week so far, the last runs. |
| Activities | The log. Search, filter, open one. |
| Plan | Race targets and weekly targets; the AI training plan per goal; the group sharing a race, if there is one. |
| Insights | Records, race predictions, benchmarks, calendar, and the AI coach. |
| Profile | Account, Strava connection, HR calibration, appearance, language. |

Profile is reached from the app bar rather than the tab bar: it is visited
occasionally, and it is not a peer of the three daily destinations.

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
  layout; the phone layout is the product.
- Installable as a PWA, so the chrome must respect safe-area insets top and
  bottom.
- AI features are rate-limited and degrade to a stated error, never to silence.
