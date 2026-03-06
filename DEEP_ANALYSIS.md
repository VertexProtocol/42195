# 42195 — Deep Analysis: Correctness, Safety & User Trust

> Analysis of training plan generation logic, data correctness, plan persistence, and user experience.
> Focus: correctness, safety, predictability, and user trust for motivated runners training toward real goals.

---

## Area 1: Planning Horizon vs Delivery Window

### What's Implemented
The plan generation (`app/api/ai/training-plan/route.ts:97-112, 148-158`) creates a fixed-length training block controlled by `prefs.block_weeks` (default: 4 weeks). The prompt tells Claude to generate exactly `blockWeeks` entries, starting "from today."

The user sets `regenerate_every_weeks` (2/4/6/8) to control how often they plan to regenerate. The `recentWindow` derived from this preference is used to compute the rolling average weekly km (line 334) and volume trend (lines 161-172).

### What's Correct
- **Block length is configurable.** Users can set 2/3/4/6-week blocks — reasonable for periodized training.
- **Volume targets are computed from recent data**, not hardcoded, using `calcWeekTargets()` (line 97).
- **Recovery week is always the final week** at 80% of peak — a sound training principle.
- **The prompt explicitly states days until race**, so Claude can phase-adjust (e.g., taper if close to race day).

### Gaps & Issues

**1.1 No awareness of the overall macrocycle.**
The prompt says "generate a N-week block starting from today" but gives no context about where this block sits in the full training arc. A 4-week block 16 weeks out from a marathon should be base-building; 4 weeks out should be peak + taper. The only signal is `daysUntilRace`, but Claude has to infer the phase entirely — there's no explicit phase labeling.

**Suggested fix:** Add a computed phase hint to the prompt:
```
const phase = daysUntilRace > 84 ? "base-building"
            : daysUntilRace > 42 ? "build"
            : daysUntilRace > 21 ? "peak"
            : "taper"
```
Include: `- Training phase: ${phase} (${daysUntilRace} days to race)`

**1.2 No taper enforcement.**
If `daysUntilRace < blockWeeks * 7`, the block extends past race day. Claude might produce a plan that ignores race day, or might not taper properly. No post-generation validation checks for this.

**Suggested fix:** Clamp `blockWeeks` to `Math.min(blockWeeks, Math.floor(daysUntilRace / 7))` and add explicit taper instructions when `daysUntilRace <= 21`.

**1.3 "Starting from today" is ambiguous.**
If a user regenerates mid-week, the new plan starts mid-week. The previous partial week's training is lost from the plan. There's no concept of "current week progress."

**Impact:** Low — runners can mentally adjust. But a coach note like "you're mid-week, carry forward any remaining sessions" would improve UX.

---

## Area 2: Plan Persistence & Regeneration

### What's Implemented
- Plans are stored in `ai_training_plans` table with `goal_id` as unique key (upsert on `onConflict: "goal_id"`).
- Previous plans are archived in a `previous_plans` JSONB array (max 5 snapshots) — lines 402-415.
- Rate limiting prevents regeneration within 60 seconds (lines 270-284).
- GET endpoint loads the cached plan (lines 457-483).
- Adjustment notes (`adjustNote`) are sanitized (regex + 500 char limit) and stored (line 259).

### What's Correct
- **Plan versioning works.** Previous plans are prepended to the array with metadata (`generated_at`, `adjust_note`, `block_start_date`).
- **Upsert ensures one active plan per goal** — no orphan plans.
- **Zod validation** (`TrainingPlanSchema`) ensures the AI output matches the expected structure before saving.
- **SSE streaming** provides real-time feedback ("thinking" → "generating" → "done").

### Gaps & Issues

**2.1 No staleness detection.**
There's no mechanism to warn users that their plan is stale. If `regenerate_every_weeks` is 4 and the plan is 6 weeks old, the app shows the old plan silently. A runner might follow an outdated plan without realizing it.

**Suggested fix:** Compare `generated_at` + `block_weeks * 7 days` against today. If expired, show a banner: "Your training block ended X days ago. Consider regenerating."

**2.2 No plan-to-activity reconciliation.**
The plan says "do 3 runs this week totaling 25 km" but there's no tracking of whether the runner actually did it. Session completion tracking (3.2) was added to `goal-detail-screen.tsx` using localStorage, but this is for the goal detail view — the plan view has no equivalent.

**Impact:** Medium — runners can compare mentally, but a "planned vs actual" comparison on the plan screen would build trust.

**2.3 Previous plans are view-only.**
There's no UI to browse previous plans or compare them. The data is stored but unused.

**2.4 adjustNote sanitization is overly strict.**
The regex `[^\w\s.,!?;:'"()\-–—/+%°#@]` strips characters like `ø`, `å`, `ä` — common in Norwegian (the app supports Norwegian via i18n). A Norwegian user's adjustment note like "Jeg har vært syk" would become "Jeg har vrt syk."

**Suggested fix:** Use a more permissive regex that allows Unicode letters: `/[^\p{L}\p{N}\s.,!?;:'"()\-–—/+%°#@]/gu`

---

## Area 3: Heart Rate Zones Correctness

### What's Implemented
`lib/training-utils.ts:242-289` — `analyzeHrZones(streams, maxHr?)`:
- If `maxHr` not provided, estimates from data: `max(observed HR) * 1.05`
- 5-zone model: Recovery (<60%), Aerobic (60-70%), Tempo (70-80%), Threshold (80-90%), VO2 Max (90-100%)
- Time-in-zone calculated from stream intervals

### What's Correct
- **The 5-zone model is standard** and matches most coaching frameworks.
- **Zone boundaries use percentage of max HR** — the conventional approach.
- **Time calculation uses actual intervals** between stream points (not fixed sampling), which is correct for variable-rate data.

### Gaps & Issues

**3.1 Max HR estimation from data is unreliable.**
`max(observed HR) * 1.05` assumes the runner hit ~95% of max HR during the recorded activity. This is only true for hard efforts. An easy recovery run might peak at 155 bpm → estimated max = 163 → zones are too low. Next hard effort at 185 bpm would show 90%+ in "VO2 Max" zone.

**The real problem:** Max HR is estimated per-activity from that activity's stream, not from the user's overall history. Two activities from the same runner will have different zone boundaries.

**Suggested fix:**
1. Compute max HR across ALL activities with stream data (global max * 1.02 is more reliable).
2. Better: let the user set their max HR in profile settings. Fall back to age-based (220 - age) or data-derived.
3. Store `max_hr` in the user's profile for consistency.

**3.2 No age-based fallback.**
The app doesn't store user age/birth year, so there's no 220-age fallback. If stream data has no HR, the function returns an empty array — correct behavior, but the user sees nothing with no explanation.

**3.3 Zone 1 boundary is 0 to 60% of max HR.**
This means everything below 60% max HR is "Recovery." In practice, HR below ~50% max is resting/walking, not training. This makes Zone 1 artificially wide and inflates "Recovery" time for activities with warmup/cooldown.

**Impact:** Low — cosmetic. Zones 2-5 are correctly bounded.

---

## Area 4: Activity Analysis Correctness

### What's Implemented
Several analysis functions in `lib/training-utils.ts` and `lib/format.ts`:

- **PR detection** (`detectPersonalRecords`): ±5% distance tolerance, pace-adjusted time
- **ACWR** (`computeACWR`): 7-day acute vs 28-day chronic weekly average
- **Training Load** (`computeTrainingLoad`): EWMA with 7-day/42-day decay constants
- **Race predictions** (`predictRaceTimes`): Riegel formula from best recent 90-day run ≥3km
- **Pace zones** (`analyzePaceZones`): Relative to activity average pace
- **Performance goals** (`evaluatePerformanceGoal`): Pace-adjusted time comparison

### What's Correct
- **PR detection tolerance (±5%) is appropriate.** GPS distance varies, so a 9.8 km run should count for 10K PR.
- **ACWR thresholds (1.3 moderate, 1.5 high) match published research** (Gabbett 2016).
- **EWMA constants (7/42 day) are standard** in sports science (Banister impulse-response model).
- **Riegel exponent (1.06) is the accepted value** for recreational runners.
- **Pace-adjusted time for performance goals** correctly normalizes for GPS distance variance.

### Gaps & Issues

**4.1 ACWR uses distance only, not training load.**
True ACWR should use session RPE × duration (sRPE) or a stress score. Using raw distance treats a 10K easy jog the same as a 10K race effort. This underestimates acute load after intense sessions.

**Impact:** The injury risk indicator will be directionally correct but may miss intensity spikes. For a training app focused on distance-based plans, this is acceptable. Adding intensity would require RPE input or HR-based stress estimation.

**Suggested minimal fix:** Weight activities by type: `distance * (type === "Race" ? 1.5 : type === "Trail Run" ? 1.3 : 1.0)` for a rough intensity proxy.

**4.2 Training load uses distance, not "stress."**
Same as 4.1 — the ATL/CTL/TSB chart shows distance-based load. This is a known simplification. The chart labels say "fatigue" and "fitness," which implies physiological stress, but it's really just volume smoothing.

**Suggested fix:** Either rename labels to "Volume Load" / "Volume Trend" or add a caveat in the UI: "Based on distance — intensity not factored in."

**4.3 Race predictions don't account for terrain.**
Riegel formula assumes flat road running. A trail runner's best 10K effort on a mountain trail would produce overly optimistic flat road predictions.

**Impact:** Medium for trail runners. The `referenceActivity` is shown, so users can see what activity the prediction is based on. No fix needed beyond perhaps filtering by activity type.

**4.4 Pace zones are per-activity, not per-runner.**
`analyzePaceZones()` computes zones relative to the current activity's average pace. A slow recovery run and a fast tempo run will have completely different zone boundaries. This is by design (showing effort distribution within a run), but the labels "Sprint/Interval/Tempo/Easy/Recovery" suggest absolute training zones.

**Impact:** Potentially confusing. A "Tempo" segment in a recovery run might be slower than an "Easy" segment in a race.

**Suggested fix:** Rename to relative labels: "Fast/Above Avg/Average/Below Avg/Slow" or use absolute pace zones based on the runner's overall best pace.

---

## Area 5: Plan Generation Waterproofing

### What's Implemented
The AI prompt (`buildPrompt()`, lines 114-238) includes:
- Runner's recent training history (12 weeks, grouped by week)
- Computed weekly volume targets with progressive overload
- Session distribution rules (long run ~40%, ordering rules)
- Volume trend analysis (upward/stable/downward)
- Adjustment note pass-through

### What's Correct
- **Progressive overload is bounded.** `weekly_increase_pct` defaults to 10%, applied cumulatively. For 4 weeks: week 1 = baseline, week 2 = +10%, week 3 = +21%, week 4 = recovery at 80%.
- **Claude can adjust targets by ±15%** based on coaching judgment — a reasonable flexibility band.
- **Session distribution rules are explicit** — long run ~40%, must be ≥1km longer than easy runs.
- **Recovery week is hardcoded** as final week at 80%.

### Gaps & Issues

**5.1 No maximum volume cap.**
If a runner's average is 80 km/week with 10% increase and 6-week blocks: week 5 would target ~117 km. For most recreational runners, this is dangerous. There's no absolute cap.

**Suggested fix:** Add a ceiling: `Math.min(calculatedTarget, currentAvg * 1.5)` — no single week should exceed 150% of baseline.

**5.2 No minimum volume floor.**
If `currentAvgWeeklyKm` is 0 (new user, no data), `calcWeekTargets` uses a hardcoded fallback of 20 km (line 98). For a complete beginner, 20 km/week might be too much. For an experienced runner whose data hasn't synced yet, it's too little.

**Suggested fix:** Prompt the user for their current weekly volume when creating a goal, rather than guessing.

**5.3 Progressive overload is purely volume-based.**
The prompt and targets focus entirely on weekly km. There's no progression for:
- Long run distance (should grow ~1-2 km/week)
- Intensity (when to introduce tempo/interval sessions)
- Session count (when to add a 4th or 5th run)

Claude may handle this via coaching judgment, but there are no guardrails.

**5.4 No validation of Claude's output against targets.**
After Zod validation, the plan is saved directly. If Claude produces a 4-week plan where week 1 = 60 km and week 2 = 30 km (violating progressive overload), it's accepted. There's no post-generation check that:
- Weekly km follows a reasonable progression
- Long run is actually the longest session
- Session count matches `prefs.sessions_per_week`

**Suggested fix:** Add post-generation validation:
```typescript
for (const week of plan.weeks) {
  if (week.sessions.length !== prefs.sessions_per_week) {
    console.warn(`Week ${week.weekNumber}: ${week.sessions.length} sessions, expected ${prefs.sessions_per_week}`)
  }
}
```
Log warnings rather than rejecting — Claude's deviations are usually intentional.

**5.5 No injury-aware plan generation.**
The prompt doesn't include the user's ACWR or training load data. If ACWR is already at 1.4 (moderate risk), the plan should back off — but Claude doesn't know this.

**Suggested fix:** Add ACWR to the prompt's "Current Fitness Snapshot":
```
- Injury risk (ACWR): ${acwr.ratio.toFixed(2)} (${acwr.risk})
```

---

## Area 6: When to Increase Speed/Distance

### What's Implemented
Volume progression is controlled by:
- `weekly_increase_pct` (default 10%) — compound increase per week
- `block_weeks` (default 4) — block length with final recovery week
- `calcWeekTargets()` — computes weekly km targets
- Volume trend analysis in the prompt (comparing recent vs prior window)

### What's Correct
- **10% rule is respected** as the default increase rate — this is the standard sports science recommendation for injury prevention.
- **Users can customize** the increase rate (the preference is stored in `goal_preferences`).
- **Volume trend is included**, so Claude can see if the runner is already ramping up too fast.

### Gaps & Issues

**6.1 No speed progression logic.**
The plan system only tracks volume (km). There's no mechanism for:
- When to introduce speed work (tempo runs, intervals)
- How to progress workout intensity over blocks
- Pace targets for specific sessions

The effort field in `TrainingSession` is a free-text string (e.g., "Easy — conversational pace"). Claude generates these, but there's no structured pace guidance based on the runner's data.

**Suggested fix:** Include the runner's recent pace in the prompt snapshot:
```
- Recent easy pace: ${easyPace} min/km (average of runs in bottom 50% by pace)
- Recent best pace: ${bestPace} min/km (fastest recent run)
```
This gives Claude data to write specific pace targets.

**6.2 Long run distance progression isn't tracked.**
The prompt says "Long run: ~40% of weekly total" but doesn't track the runner's longest recent run in the context of goal distance. A marathon runner who has never run more than 15 km needs specific long run progression to reach 30-35 km before race day.

**Current state:** `longestRecentRun` IS in the prompt, but there's no explicit instruction about how fast to grow it. Claude has to infer this.

**Suggested fix:** Add to prompt:
```
- Long run progression: current longest = ${longestRecentRun.toFixed(1)} km, goal distance = ${goal.target_distance_km} km
- Recommended long run ceiling for this block: ${Math.min(longestRecentRun + blockWeeks * 2, goal.target_distance_km * 0.85).toFixed(1)} km
```

**6.3 No 10% rule enforcement on computed targets.**
`calcWeekTargets` applies `weekly_increase_pct` compoundly. With 10% and a 6-week block, week 5 is baseline × 1.1^4 = +46%. The function has no guard against this. The compound effect is fine for 4-week blocks (+21% peak) but risky for longer blocks.

**Suggested fix:** Cap any single week at `baseline * 1.3` regardless of block length.

---

## Area 7: Weekly Frequency vs Workload Balance

### What's Implemented
- `sessions_per_week` is stored in preferences and passed to the prompt (line 182).
- The prompt instructs Claude to "Match the runner's stated preferences (sessions/week and focus)."
- Session distribution rules: long run ~40%, remaining split among easy runs.

### What's Correct
- **Session count is user-configurable** (via preferences).
- **Distribution rules prevent all-identical sessions** — the prompt explicitly says "never assign the same distance to every session."
- **Focus types** (volume/workouts/balanced) appropriately modify session structure expectations.

### Gaps & Issues

**7.1 No validation that session distances sum to targetKm.**
The prompt gives weekly volume targets AND session distribution rules. But there's no post-generation check that `sum(session.distance) ≈ week.targetKm`. Claude could generate 3 sessions totaling 30 km for a week with `targetKm: 25`. The `distance` field is a string ("18 km"), so programmatic validation would need parsing.

**Impact:** Low — Claude is generally good at arithmetic, and the Zod schema validates structure. But edge cases exist.

**7.2 No intensity distribution guidance.**
For "balanced" and "workouts" focus, there's no explicit rule about how many hard sessions per week. Sports science recommends 80/20 (80% easy, 20% hard) or at most 2 quality sessions per week for recreational runners. The prompt doesn't enforce this.

**Suggested fix:** Add to prompt:
```
## Intensity Balance
- For "workouts" or "balanced" focus: include at most 2 quality sessions (tempo, intervals, race pace) per week
- Remaining sessions should be easy effort
- Never schedule hard sessions on consecutive days
```

**7.3 No day-of-week awareness.**
The prompt explicitly says "do not specify which day of the week to run." This is a design choice (flexibility), but it means the plan can't enforce rest days between hard sessions.

**Impact:** Low — the prompt just describes what to do, not when. Runners self-schedule.

---

## Area 8: Login Performance & UX

### What's Implemented
- **Login:** `app/auth/login/page.tsx` — email/password via Supabase auth
- **Post-login redirect:** `window.location.href = "/"` (hard navigation) — line 29
- **Middleware:** `lib/supabase/middleware.ts` — calls `getUser()` on every request to refresh the session
- **Server-side data loading:** `app/page.tsx` — 6 parallel Supabase queries after auth
- **Activity fetch:** Unbounded `select("*")` with no `limit` — line 27

### What's Correct
- **Hard navigation after login is intentional and correct.** The comment (line 28-30) explains why: `router.push()` can race with cookie writes. This is a known Supabase SSR issue — `window.location.href` ensures cookies are sent fresh.
- **6 parallel queries** via `Promise.all()` is optimal — they're independent.
- **Middleware session refresh** is necessary for Supabase cookie-based auth. Without it, sessions expire silently.
- **`useTransition`** wraps the login action to show loading state without blocking the UI.

### Gaps & Issues

**8.1 Unbounded activity fetch.**
`app/page.tsx:27` fetches ALL activities with no `.limit()`. A dedicated runner with 3 years of data (1000+ activities) sends all of them on every page load. This slows initial render and increases Supabase bandwidth.

**Suggested fix:** Add `.limit(200)` for the initial fetch. Paginate or lazy-load older activities in the activities screen.

**8.2 No loading indicator during post-login redirect.**
After `signInWithPassword` succeeds, the app calls `window.location.href = "/"`. The browser does a full page load: middleware runs → server component renders → 6 DB queries → HTML response. This can take 1-3 seconds with no feedback. The login button stays at "Signing in…" during the Supabase auth call, but then the page goes blank during the redirect.

**Suggested fix:** After successful auth, keep showing a loading state or redirect to a lightweight loading page:
```typescript
// After successful auth
document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100dvh"><p>Loading your data…</p></div>'
window.location.href = "/"
```

**8.3 Middleware runs `getUser()` on every request.**
This makes a Supabase API call (or JWT validation) on every navigation. For a single-page app that loads data once and then navigates client-side, this is only triggered on the initial load and any full page refreshes — acceptable. But the middleware matcher is broad (catches most routes), including API routes which then call `getUser()` again internally.

**Suggested fix:** Exclude API routes from the middleware matcher if they already handle their own auth:
```typescript
"/((?!_next/static|_next/image|api|favicon.ico|...).*)"
```
This avoids double `getUser()` calls on API routes. Note: this changes security posture slightly — API routes must self-enforce auth (they already do).

**8.4 No sign-up confirmation flow feedback.**
Not directly about login, but related: after sign-up, the user is redirected to `/auth/sign-up-success`. If email confirmation is required (Supabase default), the user might try to log in before confirming and get a generic error.

**Impact:** Low — standard behavior for email-confirmation flows.

---

## Summary of Recommended Changes (Priority Order)

> All 15 items have been implemented.

### High Priority (correctness/safety)
1. ~~**Add volume cap** to `calcWeekTargets()` — no week > 150% of baseline (Area 5.1)~~
2. ~~**Fix adjustNote sanitization** to allow Unicode letters (Area 2.4)~~
3. ~~**Add staleness detection** for expired plan blocks (Area 2.1)~~
4. ~~**Pass ACWR to prompt** so Claude can back off if injury risk is elevated (Area 5.5)~~
5. ~~**Limit activity fetch** to 200 on initial page load (Area 8.1)~~

### Medium Priority (plan quality)
6. ~~**Add training phase hint** to prompt (base/build/peak/taper) (Area 1.1)~~
7. ~~**Clamp block weeks** to not extend past race day (Area 1.2)~~
8. ~~**Add intensity balance rules** to prompt (80/20 rule) (Area 7.2)~~
9. ~~**Include runner's pace data** in prompt snapshot (Area 6.1)~~
10. ~~**Add long run progression ceiling** to prompt (Area 6.2)~~

### Low Priority (UX polish)
11. ~~**HR zones: use global max HR** across all activities, not per-activity (Area 3.1)~~
12. ~~**Rename pace zone labels** to avoid confusion with absolute training zones (Area 4.4)~~
13. ~~**Add loading state** during post-login redirect (Area 8.2)~~
14. ~~**Add post-generation validation logging** for session counts (Area 5.4)~~
15. ~~**Exclude API routes from middleware** to avoid double auth (Area 8.3)~~
