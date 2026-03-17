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
 * A week whose volume drops below this fraction of the prior week is treated
 * as a recovery/deload week and exempt from progression caps.
 */
export const RECOVERY_WEEK_THRESHOLD = 0.85
/** Long run must not exceed this fraction of the weekly total distance */
export const LONG_RUN_MAX_FRACTION = 0.35

// ── Fatigue Detection ────────────────────────────────────────────────────────

/** Minimum total qualifying runs needed to compute a fatigue signal */
export const FATIGUE_MIN_QUALIFYING_RUNS = 8
/** Number of most-recent runs used as the "recent" sample */
export const FATIGUE_RECENT_RUNS_COUNT = 4
/** HR must exceed baseline median by this many bpm to signal HR fatigue */
export const FATIGUE_HR_ELEVATION_BPM = 5
/** Pace must exceed baseline median by this factor to signal pace fatigue (5% slower) */
export const FATIGUE_PACE_DECLINE_FACTOR = 1.05

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
/** Weeks below this fraction of the block average are treated as deload weeks */
export const CHECKPOINT_DELOAD_WEEK_THRESHOLD = 0.75
/** Completed weeks below this fraction of planned are treated as missed (excluded from adherence) */
export const CHECKPOINT_MISSED_WEEK_THRESHOLD = 0.20
/** Minimum scale factor when adjusting under-performing plans */
export const CHECKPOINT_MIN_SCALE = 0.55
/** Maximum scale factor when adjusting over-performing plans */
export const CHECKPOINT_MAX_SCALE = 1.30

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
/** Optimistic confidence bound (faster end of prediction range) */
export const RIEGEL_EXPONENT_OPTIMISTIC = 1.03
/** Conservative confidence bound (slower end of prediction range) */
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

// ── Resting HR Estimation ────────────────────────────────────────────────────

/**
 * Approximate BPM offset subtracted from the average easy-run HR to estimate
 * resting HR. This is a rough heuristic — not a clinical resting HR measurement.
 */
export const RESTING_HR_OFFSET = 45

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
/** Minimum avg km/week for advanced classification */
export const ATHLETE_ADVANCED_KM_PER_WEEK = 50
/** Minimum avg sessions/week for advanced classification */
export const ATHLETE_ADVANCED_SESSIONS_PER_WEEK = 4
/** Minimum avg km/week for intermediate classification */
export const ATHLETE_INTERMEDIATE_KM_PER_WEEK = 20
/** Minimum avg sessions/week for intermediate classification */
export const ATHLETE_INTERMEDIATE_SESSIONS_PER_WEEK = 2
