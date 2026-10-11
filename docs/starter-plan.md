# Starter onboarding without imported history

The home screen adds no card. Strava import is offered before assessment; partial or running sync waits, with explicit opt-out. The starter plan is available in the goal list and on its own screen. A signed-in, account-keyed React cache keeps the plan visible during navigation with background revalidation. The plan overview contains week progress and compact session stops; tapping a stop opens instructions and feedback. Plan options contain history and editing. Provisional-source information is disclosed on demand.

Three starting points: beginner, self-reported current training, or return after a break. Answers include intention, available days, current continuous running time, usual weekly running time where relevant, break length, and discomfort. An event intention does not imply race readiness or a promised completion date.

State lives in `starter_plans`, separate from measured activities. Ownership RLS and optimistic version checks protect cross-account isolation and concurrent feedback. The additive migration does not rewrite existing plans. The coach receives explicitly labelled self-reported context.

The first plan is a provisional seven-day schedule with time and effort rather than inferred pace or race predictions. Run/walk sessions use rest days. The starter template's 60-second running / 90-second walking alternation and walking warm-up/cool-down are informed by [NHS Couch to 5K](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/). This is not the NHS nine-week programme. Return factors, duration caps and adaptation rules are app heuristics, not clinically validated personal prescriptions.

Feedback distinguishes completed-easy, manageable, too-hard, missed-for-time, and discomfort. Next week requires a completed seven-day period and all session responses. Time pressure does not reduce assumed capacity. Two consecutive easy weeks permit a small time increase; difficulty reduces or maintains time. Pain pauses pending sessions and blocks automatic progression until the starting point is reviewed. Updating answers restarts a provisional week and retains prior feedback history (up to 12 weeks).

Verification: unit tests cover all starting modes, low-volume bounds, rest days, feedback, progression and pain. Component tests create and reload a plan and check failed persistence. API tests cover auth, ownership and version conflicts. `supabase/tests/starter_plans_rls.sql` checks live ownership rules with synthetic fixtures inside a rolled-back transaction. No real activity history is created by feedback.

## Starting-dose audit (11 October 2026)

The previous rules always put beginners on run/walk regardless of reported current capacity. A guessed weekly volume, guessed long pause and guessed zero capacity could compound into a 12.5-minute comeback session with just one running minute. These are product logic defects, not evidence that every beginner should train harder.

Current continuous capacity of at least ten minutes now selects continuous easy running, independent of the beginner/returning label. Unknown capacity keeps run/walk; it is not treated as measured zero. If both volume and capacity are unknown, the exploratory start stays at twenty minutes instead of multiplying guessed historical inputs. Known weekly volume still constrains the schedule, including return reduction; estimated volume does not override explicitly reported current capacity. Duration is calculated against the actual allowed session count, including the three-day limit for beginner/run-walk/long-break profiles.

Examples with two available days: a self-described beginner currently able to run twenty minutes gets two twenty-minute easy sessions; an experienced runner reporting thirty-minute current capacity but unknown weekly volume gets two thirty-minute sessions; an all-unknown returner gets twenty-minute run/walk sessions instead of 12.5 minutes. These are bounded product heuristics, not clinically validated optimal doses. NHS supports a gentle one-minute run / ninety-second walk pattern for absolute beginners; it does not validate these app-specific dose mappings.

Existing stored weeks remain unchanged. Updating the starting point generates a new provisional week and retains the prior one in history. Progression and pain gates are unchanged.
