/**
 * Central registry of training algorithm constants.
 *
 * All scientific coefficients, safety thresholds, and tuning parameters live
 * here so that a change in one place propagates everywhere automatically.
 * This file has zero imports and is safe to use in both server and client code.
 */

// ── ACWR (Acute:Chronic Workload Ratio) ──────────────────────────────────────

/** Sliding window for acute (recent) load — matches ATL half-life */
export const ACWR_ACUTE_DAYS = 7
/** Sliding window for chronic (baseline) load */
export const ACWR_CHRONIC_DAYS = 28
/** Number of chronic weeks used for per-week averaging */
export const ACWR_CHRONIC_WEEKS = ACWR_CHRONIC_DAYS / 7 // 4
/** ACWR above this threshold signals elevated injury risk */
export const ACWR_HIGH_THRESHOLD = 1.3
/** ACWR above this threshold signals unsafe load (forced reduction) */
export const ACWR_UNSAFE_THRESHOLD = 1.5
/**
 * ACWR below this threshold means the runner is training well under their own
 * baseline — the detraining end of the sweet spot, not a safe "low" reading.
 * Together with ACWR_HIGH_THRESHOLD this defines the 0.8–1.3 optimal band that
 * the load indicator draws on its scale.
 */
export const ACWR_LOW_THRESHOLD = 0.8

// ── Training Load EWMA (ATL / CTL / TSB) ────────────────────────────────────

/** Acute Training Load half-life — fatigue decay constant (days) */
export const ATL_HALF_LIFE_DAYS = 7
/** Chronic Training Load half-life — fitness decay constant (days) */
export const CTL_HALF_LIFE_DAYS = 42
/** Extra days prepended as EWMA warmup buffer before the output window */
export const TRAINING_LOAD_BUFFER_DAYS = 120
/** Number of days included in the returned training load output */
export const TRAINING_LOAD_OUTPUT_DAYS = 90

// ── Load Progression ─────────────────────────────────────────────────────────

/**
 * A week whose PLANNED volume drops below this fraction of the PRIOR planned
 * week is treated as a recovery week and exempt from forward progression
 * caps. Used by checkSkipLoadSpike to suppress warnings when the next week
 * is an intentional taper.
 *
 * Not the same as CHECKPOINT_DELOAD_WEEK_THRESHOLD (0.75): that one looks
 * retrospectively at COMPLETED weeks relative to the BLOCK AVERAGE, and
 * only excludes them from the mid-block adherence calculation. The two
 * concepts have similar "this is a reduction week" shape but live in
 * different analyses (forward-looking vs backwards-looking) with
 * deliberately different thresholds.
 */
export const RECOVERY_WEEK_THRESHOLD = 0.85
/** Long run must not exceed this fraction of the weekly total distance */
export const LONG_RUN_MAX_FRACTION = 0.35

/**
 * Tolerance band for "relevant" reference runs around a goal distance.
 * 0.25 means runs within 75–125% of the goal qualify. Wider than the
 * original 20% so half-marathon goals can borrow from a 17 km long run
 * (close enough to extrapolate via Riegel without losing meaningful
 * accuracy — exponent 1.06 yields ≈3% error at 25%).
 */
export const BEST_RELEVANT_RUN_WINDOW = 0.25

// ── Fatigue Detection ────────────────────────────────────────────────────────

/** Minimum total qualifying runs needed to compute a fatigue signal */
export const FATIGUE_MIN_QUALIFYING_RUNS = 8
/** Number of most-recent runs used as the "recent" sample */
export const FATIGUE_RECENT_RUNS_COUNT = 4
/** HR must exceed baseline median by this many bpm to signal HR fatigue */
export const FATIGUE_HR_ELEVATION_BPM = 5
/** Pace must exceed baseline median by this factor to signal pace fatigue (5% slower) */
export const FATIGUE_PACE_DECLINE_FACTOR = 1.05
/**
 * If the most recent qualifying run is older than this many days, fatigue
 * detection returns "none" — comparing pre-pause runs to even older runs
 * produces stale signals that the runner can't act on.
 */
export const FATIGUE_FRESHNESS_DAYS = 10
/**
 * Like-for-like guard on the fatigue comparison. Recent runs and baseline runs
 * are compared as whole samples, so a block of hard sessions against a block of
 * easy ones reads as "HR up" (and an easy week against a hard one as "pace
 * down") when nothing is wrong.
 *
 * A signal is therefore only accepted when the OTHER variable did not move in
 * the direction that would explain it: HR may only count as elevated if the
 * recent runs were not meaningfully faster, and pace may only count as
 * declining if the effort was not meaningfully lower. This tolerance is how
 * much drift counts as "meaningful" (2%).
 */
export const FATIGUE_INTENSITY_MATCH_TOLERANCE = 0.02

// ── Prolonged Fatigue / Forced Deload ────────────────────────────────────────

/** TSB below this value counts toward prolonged-fatigue detection */
export const PROLONGED_FATIGUE_TSB_THRESHOLD = -15
/** Consecutive weeks below the TSB threshold that trigger a forced deload */
export const PROLONGED_FATIGUE_CONSECUTIVE_WEEKS = 3
/** Volume multiplier applied to the first plan week during a forced deload */
export const PROLONGED_FATIGUE_DELOAD_MULTIPLIER = 0.60

// ── Mid-Block Checkpoint ─────────────────────────────────────────────────────

/** Adherence below this fraction triggers a downward plan adjustment */
export const CHECKPOINT_UNDER_THRESHOLD = 0.70
/** Adherence above this fraction triggers an upward plan adjustment */
export const CHECKPOINT_OVER_THRESHOLD = 1.35
/** Minimum block length (weeks) for a checkpoint to be applicable */
export const CHECKPOINT_MIN_BLOCK_WEEKS = 4
/**
 * During checkpoint adherence analysis, a completed week whose PLANNED
 * volume is below this fraction of the BLOCK AVERAGE is treated as a
 * deload week for scaling purposes (see adjustRemainingWeeks).
 *
 * Distinct from RECOVERY_WEEK_THRESHOLD (0.85) — that threshold is
 * forward-looking (next-week planned / prior-week planned) and feeds
 * the skip-load spike check, not the checkpoint. Kept as separate
 * constants so each analysis can tune its own sensitivity.
 */
export const CHECKPOINT_DELOAD_WEEK_THRESHOLD = 0.75
/** Completed weeks below this fraction of planned are treated as missed (excluded from adherence) */
export const CHECKPOINT_MISSED_WEEK_THRESHOLD = 0.20
/** Minimum scale factor when adjusting under-performing plans */
export const CHECKPOINT_MIN_SCALE = 0.55
/** Maximum scale factor when adjusting over-performing plans */
export const CHECKPOINT_MAX_SCALE = 1.30

// ── Comeback after Pause ─────────────────────────────────────────────────────

/** Minimum gap (days) since last run that qualifies as a pause requiring a ramp */
export const COMEBACK_PAUSE_THRESHOLD_DAYS = 7
/** Further volume reduction applied when an active injury is noted in notes_history */
export const COMEBACK_INJURY_REDUCTION = 0.80
/** Weeks of history used to compute the runner's pre-pause weekly average */
export const COMEBACK_PREPAUSE_WINDOW_WEEKS = 4
/** Week-one floor — never recommend less than this many km on return */
export const COMEBACK_FLOOR_KM = 3

// ── Intra-block Pace Progression ─────────────────────────────────────────────

/**
 * Weekly pace improvement applied to quality sessions (tempo, intervals) as
 * the training block advances. Scaled by athlete level so progression stays
 * proportional to the runner's training history and recovery capacity.
 *
 * Combined with PACE_PROGRESSION_MAX_WEEKS = 6, the worst-case tempo target
 * (advanced, week 6+) is pred10K × 1.04 × 0.98 = pred10K × 1.019 — tempo
 * stays ~2% slower than 10K race pace, which is physiologically sound.
 */
export const PACE_PROGRESSION_RATES: Record<string, number> = {
  beginner:     0.002,  // 0.2%/week → 1.0% max over 6 weeks
  intermediate: 0.003,  // 0.3%/week → 1.5% max over 6 weeks
  advanced:     0.004,  // 0.4%/week → 2.0% max over 6 weeks
}

/**
 * Progression is capped at 6 weeks for all levels. This ensures that even at
 * the highest rate (0.4%/week), tempo paces stay safely below 10K race pace
 * (the base tempo target already has a 4% buffer above 10K pace — consuming
 * at most 2% of that still leaves a ~2% margin). Weeks beyond 6 hold steady.
 */
export const PACE_PROGRESSION_MAX_WEEKS = 6

// ── Elevation Effort (Minetti et al.) ────────────────────────────────────────

/**
 * Converts grade (elevation_gain_m / distance_m) to an effort multiplier.
 * Each 1% grade adds ~8% effort (1 m of climbing ≈ 8 m of flat-equivalent effort).
 */
export const ELEVATION_GRADE_EFFORT_FACTOR = 8

// ── Riegel Race Prediction ───────────────────────────────────────────────────

/** Standard Riegel fatigue exponent */
export const RIEGEL_EXPONENT = 1.06
/** Lower bound on the exponent (well-trained athletes) */
export const RIEGEL_EXPONENT_MIN = 1.01
/** Upper bound on the exponent (less-trained athletes) */
export const RIEGEL_EXPONENT_MAX = 1.12
/**
 * Optimistic confidence bound — produces the FASTER end of the prediction
 * range. In Riegel's T_goal = T_ref × (D_goal / D_ref)^exp, a LOWER exponent
 * yields a smaller multiplier and therefore a shorter (faster) predicted
 * time at longer distances. Optimistic here means "optimistic about your
 * performance" — you're projecting toward a well-trained athlete's curve.
 */
export const RIEGEL_EXPONENT_OPTIMISTIC = 1.03
/**
 * Conservative confidence bound — produces the SLOWER end of the prediction
 * range. Higher exponent = bigger multiplier = longer (slower) predicted
 * time at longer distances. Conservative here means "don't over-promise".
 */
export const RIEGEL_EXPONENT_CONSERVATIVE = 1.09
/** Lookback window for selecting the reference activity for race prediction */
export const RACE_PREDICTION_LOOKBACK_DAYS = 90
/** Activities within this many days receive full recency weight */
export const RACE_PREDICTION_RECENCY_THRESHOLD_DAYS = 30
/** Days over which the recency penalty grows from 0 to its maximum */
export const RACE_PREDICTION_RECENCY_FADE_DAYS = 60
/** Maximum recency penalty applied to older activities (fraction, e.g. 0.05 = 5%) */
export const RACE_PREDICTION_MAX_RECENCY_PENALTY = 0.05

// ── HR Zone Model (5-zone % of max HR) ──────────────────────────────────────

export const HR_ZONE_LABELS = [
  "Recovery",
  "Aerobic",
  "Tempo",
  "Threshold",
  "VO2 Max",
] as const

/**
 * Zone boundaries as [minPct, maxPct] fractions of max HR.
 * Index 0 = Zone 1 (Recovery), index 4 = Zone 5 (VO2 Max).
 */
export const HR_ZONE_PCTS: readonly [number, number][] = [
  [0.50, 0.60], // Z1 Recovery
  [0.60, 0.70], // Z2 Aerobic
  [0.70, 0.80], // Z3 Tempo
  [0.80, 0.90], // Z4 Threshold
  [0.90, 1.00], // Z5 VO2 Max
]

// ── HR Analysis ──────────────────────────────────────────────────────────────

/** BPM tolerance when comparing two zone sets for equality */
export const HR_ZONE_MATCH_TOLERANCE = 3
/** Max HR difference (as a fraction) above which zones are likely misconfigured */
export const HR_MAJOR_MISALIGNMENT_THRESHOLD = 0.08
/** Max HR difference (as a fraction) above which zones are slightly misaligned */
export const HR_MINOR_MISALIGNMENT_THRESHOLD = 0.04
/** If more than this fraction of activities cluster in a single zone, flag it */
export const HR_ZONE_CLUSTER_THRESHOLD = 0.70

/** Minimum recorded peaks needed before max HR is treated as observed rather than estimated */
export const HR_MIN_PEAK_SAMPLES = 3
/**
 * How far a peak may stand above the next-highest one before it is treated as
 * a sensor artifact rather than a real effort.
 *
 * The test is isolation, not height: chest straps and optical sensors throw
 * lone spikes tens of bpm clear of everything else, whereas a genuine maximal
 * effort is corroborated by the next-hardest session within a few bpm. A
 * margin measured against the *typical* peak would instead throw away the one
 * hard session that actually reached max — which is precisely the sample that
 * matters most here.
 */
export const HR_PEAK_SPIKE_GAP = 15
/**
 * An isolated peak is kept anyway when the activity's *average* HR reaches
 * this fraction of it. You cannot average 85% of a heart rate you never hit,
 * so a high average corroborates the peak — while a one-second sensor spike
 * leaves the average of the surrounding hour untouched. This is what tells a
 * maximal race effort apart from a strap glitch when both stand alone.
 */
export const HR_PEAK_EFFORT_RATIO = 0.85

// ── Resting HR ───────────────────────────────────────────────────────────────

/**
 * Plausible resting HR range. A value outside this is rejected rather than
 * fed into the Karvonen model, where it would silently distort every zone.
 */
export const RESTING_HR_MIN = 25
export const RESTING_HR_MAX = 110

// ── Skip Load Spike Detection ─────────────────────────────────────────────────

/** Spike percentage (integer, 0–100) above which severity is "danger" vs "caution" */
export const SKIP_LOAD_SPIKE_DANGER_THRESHOLD = 30

// ── Prolonged Fatigue Load History ───────────────────────────────────────────

/**
 * Minimum number of training load data points required before
 * checkProlongedFatigue will attempt to sample 6 weekly data points.
 * Equals 6 weeks × 7 days so that no weekly sample aliases to loadPoints[0].
 */
export const PROLONGED_FATIGUE_MIN_POINTS = 42 // 6 * 7

// ── Athlete Classification ───────────────────────────────────────────────────

/** Rolling window (weeks) used to classify athlete level */
export const ATHLETE_CLASSIFICATION_WEEKS = 12
/**
 * Runs needed inside the classification window before a level means anything.
 * Below this the classifier returns "beginner" as a fallback, which is not the
 * same claim — callers that display the level must say "not enough history"
 * instead of asserting the fallback (see hasAthleteLevelEvidence).
 */
export const ATHLETE_MIN_CLASSIFIABLE_RUNS = 4
/** Minimum avg km/week for advanced classification */
export const ATHLETE_ADVANCED_KM_PER_WEEK = 50
/** Minimum avg sessions/week for advanced classification */
export const ATHLETE_ADVANCED_SESSIONS_PER_WEEK = 4
/** Minimum avg km/week for intermediate classification */
export const ATHLETE_INTERMEDIATE_KM_PER_WEEK = 20
/** Minimum avg sessions/week for intermediate classification */
export const ATHLETE_INTERMEDIATE_SESSIONS_PER_WEEK = 2

// ── Activity Types ───────────────────────────────────────────────────────────

/**
 * Activity types that count as running. Every volume, load, adherence and
 * fitness calculation filters on this set — cycling and hiking inflate
 * chronic load and weekly km, which makes running plans wrong in both
 * directions. Shared between server and client so the two can't diverge.
 */
export const RUN_TYPES: ReadonlySet<string> = new Set([
  "Run",
  "Trail Run",
  "Virtual Run",
  "Treadmill",
  "Race",
])

// ── Plan Regeneration ────────────────────────────────────────────────────────

/**
 * Minimum time between plan generations for one goal. Prevents plan churn and
 * runaway AI cost. Users who want to tweak should use the "Adjust" note.
 */
export const PLAN_REGENERATE_COOLDOWN_MS = 10 * 60 * 1000

// ── Session Distance Allocation ──────────────────────────────────────────────

/** All prescribed session distances are multiples of this (km) */
export const SESSION_DISTANCE_STEP_KM = 0.5
/** Minimum useful session length — below this the aerobic stimulus is marginal */
export const MIN_SESSION_KM = 5
/** Relaxed minimum for weeks that cannot support MIN_SESSION_KM across every session */
export const MIN_SESSION_KM_LOW_VOLUME = 4
/** Weekly volume below which the relaxed session minimum applies */
export const LOW_VOLUME_WEEK_KM = 15
/**
 * How far the long run should lead the next-longest session (km). Best-effort:
 * the long-run share cap always wins, so very small weeks may fall short.
 */
export const LONG_RUN_MIN_LEAD_KM = 2
/**
 * Headroom added to the 1/n floor when deriving the long-run share cap.
 *
 * LONG_RUN_MAX_FRACTION (0.35) is unreachable at low session counts — with two
 * sessions the smallest possible share for the longest one is 50%, and with
 * three it is 33.3%. Applied literally, the cap flags every 2-session week and
 * cannot be satisfied at all. The effective cap is therefore
 * max(LONG_RUN_MAX_FRACTION, 1/n + margin), which also guarantees the long run
 * is strictly the longest session (since the share exceeds 1/n).
 */
export const LONG_RUN_FRACTION_MARGIN = 0.05

// ── Fitness Analysis Window ──────────────────────────────────────────────────

/**
 * Weeks of history used to derive the runner's current form: the rolling weekly
 * average that seeds a plan, and the trend line reported to the coach.
 *
 * Fixed rather than taken from `regenerate_every_weeks`. That preference is
 * presented as "how often you want a new plan — you'll see a reminder", but it
 * also used to set this window, so choosing 8 weeks instead of 2 silently
 * changed the training baseline, the trend and therefore the plan. Four weeks
 * matches every other rolling window in the engine (ACWR_CHRONIC_WEEKS,
 * COMEBACK_PREPAUSE_WINDOW_WEEKS, the frequency check).
 */
export const FITNESS_ANALYSIS_WEEKS = 4

// ── Training Load Indicator (UI) ─────────────────────────────────────────────

/**
 * Minimum RUN activities before the training load card is worth rendering at
 * all. Below this there is nothing to compute — not even a "building baseline"
 * message, because the runner has not started.
 *
 * Shared with the Today screen so its gate and the card's own gate cannot
 * drift apart: the screen used to require 7 activities of ANY type while the
 * card required 4 runs, so seven bike rides mounted a card that rendered
 * nothing.
 */
export const LOAD_INDICATOR_MIN_RUNS = 4

/** How far back the card looks when calling fitness rising, steady or easing */
export const FITNESS_TREND_LOOKBACK_DAYS = 14
/** CTL must move by more than this over the lookback to count as a direction */
export const FITNESS_TREND_MIN_DELTA = 0.3

// ── Injury Notes ─────────────────────────────────────────────────────────────

/**
 * An unresolved injury note older than this is worth asking about. It keeps
 * tightening the comeback cap and keeps reaching the coach as a current
 * restriction, and people rarely go back to mark one resolved.
 *
 * The note is not expired automatically — whether an injury still matters is
 * the runner's call, not the code's. This only decides when to ask.
 */
export const INJURY_NOTE_STALE_WEEKS = 8
