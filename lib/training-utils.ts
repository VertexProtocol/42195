import type { Activity, StreamPoint } from "@/lib/types"
import {
  ACWR_ACUTE_DAYS,
  ACWR_CHRONIC_DAYS,
  ACWR_CHRONIC_WEEKS,
  ACWR_HIGH_THRESHOLD,
  ACWR_UNSAFE_THRESHOLD,
  ATL_HALF_LIFE_DAYS,
  CTL_HALF_LIFE_DAYS,
  TRAINING_LOAD_BUFFER_DAYS,
  TRAINING_LOAD_OUTPUT_DAYS,
  ELEVATION_GRADE_EFFORT_FACTOR,
  RIEGEL_EXPONENT,
  RIEGEL_EXPONENT_MIN,
  RIEGEL_EXPONENT_MAX,
  RIEGEL_EXPONENT_OPTIMISTIC,
  RIEGEL_EXPONENT_CONSERVATIVE,
  RACE_PREDICTION_LOOKBACK_DAYS,
  RACE_PREDICTION_RECENCY_THRESHOLD_DAYS,
  RACE_PREDICTION_RECENCY_FADE_DAYS,
  RACE_PREDICTION_MAX_RECENCY_PENALTY,
  HR_ZONE_LABELS,
  HR_ZONE_PCTS,
} from "@/lib/training-constants"

// ---- Elevation effort helpers ----

/**
 * Effort multiplier based on elevation gain.
 * Research (Minetti et al.) shows each metre of climbing costs roughly 8 metres
 * of equivalent flat running effort, so we add 0.8% effort per m/km of average grade.
 * Returns 1.0 when there is no elevation data or the run is flat.
 */
export function elevationEffortMultiplier(
  distance_km: number,
  elevation_gain_m: number | null | undefined,
): number {
  if (!elevation_gain_m || elevation_gain_m <= 0 || distance_km <= 0) return 1
  // grade as a fraction (m gained / m covered)
  const grade = elevation_gain_m / (distance_km * 1000)
  return 1 + grade * ELEVATION_GRADE_EFFORT_FACTOR
}

/**
 * Converts actual distance to flat-terrain effort equivalent.
 * A 10 km run with 100 m of gain becomes ~10.8 km equivalent effort.
 */
export function effortAdjustedKm(
  distance_km: number,
  elevation_gain_m: number | null | undefined,
): number {
  return distance_km * elevationEffortMultiplier(distance_km, elevation_gain_m)
}

/**
 * Grade-adjusted pace: normalises raw pace to what it would be on flat ground.
 * E.g. 6:00/km at 5% average grade ≈ 5:33/km flat-equivalent.
 */
export function gradeAdjustedPace(
  pace_min_per_km: number,
  distance_km: number,
  elevation_gain_m: number | null | undefined,
): number {
  return pace_min_per_km / elevationEffortMultiplier(distance_km, elevation_gain_m)
}

// ---- 3.3 Personal Records (PR) Detection ----

export interface PersonalRecord {
  distance_label: string
  distance_km: number
  time_seconds: number
  pace_min_per_km: number
  activity: Activity
  date: string
}

/** Standard distances for PR detection */
const PR_DISTANCES = [
  { label: "1 km", km: 1 },
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
] as const

/**
 * Detects personal records for standard distances.
 * An activity qualifies if its distance is within ±5% of the target distance.
 * The PR time is pace-adjusted to exactly the standard distance.
 */
export function detectPersonalRecords(activities: Activity[]): PersonalRecord[] {
  const records: PersonalRecord[] = []

  for (const { label, km } of PR_DISTANCES) {
    const lo = km * 0.95
    const hi = km * 1.05
    const qualifying = activities.filter(
      (a) => a.distance_km >= lo && a.distance_km <= hi && a.duration_seconds > 0,
    )
    if (qualifying.length === 0) continue

    // Best = smallest flat-equivalent time for exactly the standard distance.
    // Grade-adjusting prevents a hilly slow run from ranking below a faster flat run.
    let best = qualifying[0]
    let bestFlatTime = (km / best.distance_km) * best.duration_seconds /
      elevationEffortMultiplier(best.distance_km, best.elevation_gain_m)

    for (const a of qualifying.slice(1)) {
      const flatTime = (km / a.distance_km) * a.duration_seconds /
        elevationEffortMultiplier(a.distance_km, a.elevation_gain_m)
      if (flatTime < bestFlatTime) {
        best = a
        bestFlatTime = flatTime
      }
    }

    // Store the actual (raw) time for the winning activity, pace-adjusted to standard distance
    const rawTime = (km / best.distance_km) * best.duration_seconds
    records.push({
      distance_label: label,
      distance_km: km,
      time_seconds: Math.round(rawTime),
      pace_min_per_km: rawTime / 60 / km,
      activity: best,
      date: best.date,
    })
  }

  return records
}

// ---- 3.7 Injury Risk Indicator (ACWR) ----

export interface AcwrResult {
  acuteLoad: number    // 7-day load in km
  chronicLoad: number  // 28-day average weekly load in km
  ratio: number        // acute / chronic
  risk: "low" | "high" | "unsafe"
}

/**
 * Computes Acute:Chronic Workload Ratio.
 * Acute = last 7 days distance. Chronic = 28-day average weekly distance.
 * Risk: ≤1.3 = low (sweet spot), 1.3–1.5 = high (elevated), >1.5 = unsafe (forced reduction).
 */
export function computeACWR(
  activities: Array<{ date: string; distance_km: number; elevation_gain_m?: number | null }>,
): AcwrResult {
  const now = Date.now()
  const day7 = now - ACWR_ACUTE_DAYS * 24 * 60 * 60 * 1000
  const day28 = now - ACWR_CHRONIC_DAYS * 24 * 60 * 60 * 1000

  const acuteLoad = activities
    .filter((a) => new Date(a.date).getTime() >= day7)
    .reduce((s, a) => s + effortAdjustedKm(a.distance_km, a.elevation_gain_m), 0)

  const chronicTotal = activities
    .filter((a) => new Date(a.date).getTime() >= day28)
    .reduce((s, a) => s + effortAdjustedKm(a.distance_km, a.elevation_gain_m), 0)

  const chronicLoad = chronicTotal / ACWR_CHRONIC_WEEKS

  const ratio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0

  let risk: AcwrResult["risk"] = "low"
  if (ratio > ACWR_UNSAFE_THRESHOLD) risk = "unsafe"
  else if (ratio > ACWR_HIGH_THRESHOLD) risk = "high"

  return { acuteLoad, chronicLoad, ratio, risk }
}

// ---- 3.8 Training Load Graph (ATL/CTL/TSB) ----

export interface TrainingLoadPoint {
  date: string
  atl: number  // Acute Training Load (fatigue) — 7-day EWMA
  ctl: number  // Chronic Training Load (fitness) — 42-day EWMA
  tsb: number  // Training Stress Balance (form) — CTL - ATL
}

/**
 * Computes daily ATL/CTL/TSB using exponentially weighted moving averages.
 * ATL time constant = 7 days, CTL time constant = 42 days.
 * Decay factors use the correct formula α = 1 - e^(-ln(2)/n) so that
 * the half-life equals the stated number of days.
 * Returns the last 90 days of data points.
 */
export function computeTrainingLoad(
  activities: Array<{ date: string; distance_km: number; elevation_gain_m?: number | null }>,
): TrainingLoadPoint[] {
  if (activities.length === 0) return []

  // Build daily effort-adjusted distance map for the last 120 days (buffer for EWMA warmup)
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  const startDays = TRAINING_LOAD_BUFFER_DAYS
  const outputDays = TRAINING_LOAD_OUTPUT_DAYS

  const dailyLoad = new Map<string, number>()
  for (const a of activities) {
    const d = a.date.split("T")[0]
    dailyLoad.set(d, (dailyLoad.get(d) ?? 0) + effortAdjustedKm(a.distance_km, a.elevation_gain_m))
  }

  const points: TrainingLoadPoint[] = []
  // α = 1 - e^(-ln(2)/n) gives true n-day half-life
  const atlDecay = 1 - Math.exp(-Math.LN2 / ATL_HALF_LIFE_DAYS)
  const ctlDecay = 1 - Math.exp(-Math.LN2 / CTL_HALF_LIFE_DAYS)

  let atl = 0
  let ctl = 0

  for (let i = startDays; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split("T")[0]
    const load = dailyLoad.get(dateStr) ?? 0

    atl = atl * (1 - atlDecay) + load * atlDecay
    ctl = ctl * (1 - ctlDecay) + load * ctlDecay

    if (i < outputDays) {
      points.push({
        date: dateStr,
        atl: Math.round(atl * 100) / 100,
        ctl: Math.round(ctl * 100) / 100,
        tsb: Math.round((ctl - atl) * 100) / 100,
      })
    }
  }

  return points
}

// ---- 3.9 Race Time Prediction ----

export interface RacePrediction {
  distance_label: string
  distance_km: number
  predicted_seconds: number
  /** Lower bound (optimistic) — ~3% faster based on Riegel exponent variance */
  low_seconds: number
  /** Upper bound (conservative) — ~3% slower based on Riegel exponent variance */
  high_seconds: number
}

export const PREDICTION_DISTANCES = [
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
] as const

/**
 * Predicts race times using the Riegel formula:
 * T2 = T1 * (D2 / D1)^exponent
 *
 * Uses the best recent activity (last 90 days, >= 3km) as the reference.
 * If an exponentAdjustment is provided (from test run validation feedback),
 * it shifts the base exponent (1.06) to produce more personalized predictions.
 */
export function predictRaceTimes(activities: Activity[], exponentAdjustment?: number): {
  predictions: RacePrediction[]
  referenceActivity: Activity | null
} {
  const cutoff = Date.now() - RACE_PREDICTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const recent = activities.filter(
    (a) =>
      new Date(a.date).getTime() >= cutoff &&
      a.distance_km >= 3 &&
      a.duration_seconds > 0,
  )

  if (recent.length === 0) return { predictions: [], referenceActivity: null }

  // Find best "VDOT" equivalent — fastest pace-adjusted 5k equivalent,
  // with recency weighting: activities within 30 days get full weight,
  // older activities are penalized by up to 5% to prefer recent fitness.
  const now = Date.now()
  let bestRef = recent[0]
  let bestScore = Infinity

  for (const a of recent) {
    // Use flat-equivalent duration so hilly runs don't get unfairly penalised
    const flatDuration = a.duration_seconds / elevationEffortMultiplier(a.distance_km, a.elevation_gain_m)
    const equiv = (5 / a.distance_km) ** 1.06 * flatDuration
    const daysOld = (now - new Date(a.date).getTime()) / (24 * 60 * 60 * 1000)
    const recencyPenalty = daysOld <= RACE_PREDICTION_RECENCY_THRESHOLD_DAYS
      ? 1.0
      : 1.0 + ((daysOld - RACE_PREDICTION_RECENCY_THRESHOLD_DAYS) / RACE_PREDICTION_RECENCY_FADE_DAYS) * RACE_PREDICTION_MAX_RECENCY_PENALTY
    const score = equiv * recencyPenalty
    if (score < bestScore) {
      bestRef = a
      bestScore = score
    }
  }

  // Riegel exponent variance: 1.06 is the standard, but real-world values
  // range from ~1.01 (well-trained) to ~1.12 (less trained). We use ±0.03
  // to produce a practical confidence band.
  // If test run validation data suggests an adjustment, apply it.
  const exponent = Math.max(RIEGEL_EXPONENT_MIN, Math.min(RIEGEL_EXPONENT_MAX, RIEGEL_EXPONENT + (exponentAdjustment ?? 0)))
  const exponentLow = RIEGEL_EXPONENT_OPTIMISTIC
  const exponentHigh = RIEGEL_EXPONENT_CONSERVATIVE

  // Use flat-equivalent reference time so hilly reference runs project correctly to flat races
  const refFlatSeconds = bestRef.duration_seconds / elevationEffortMultiplier(bestRef.distance_km, bestRef.elevation_gain_m)

  const predictions: RacePrediction[] = PREDICTION_DISTANCES.map(({ label, km }) => {
    const ratio = km / bestRef.distance_km
    return {
      distance_label: label,
      distance_km: km,
      predicted_seconds: Math.round(refFlatSeconds * ratio ** exponent),
      low_seconds: Math.round(refFlatSeconds * ratio ** exponentLow),
      high_seconds: Math.round(refFlatSeconds * ratio ** exponentHigh),
    }
  })

  return { predictions, referenceActivity: bestRef }
}

// ---- 3.5 Heart Rate Zone Analysis ----

export interface HrZone {
  zone: number
  label: string
  min: number
  max: number
  seconds: number
  percentage: number
  color: string
}

const HR_ZONE_COLORS = [
  "var(--chart-2)", // Zone 1 - gray/blue
  "var(--chart-4)", // Zone 2 - green
  "var(--chart-1)", // Zone 3 - yellow
  "var(--chart-3)", // Zone 4 - orange
  "var(--chart-5)", // Zone 5 - red
]

/**
 * Calculates time spent in each HR zone from stream data.
 * Uses 5-zone model based on max HR.
 *
 * For best results, pass `maxHr` from the user's profile or computed as
 * the global max HR across all activities (× 1.02). If not provided,
 * estimates from the current stream data (less reliable for easy runs).
 */
export function analyzeHrZones(
  streams: StreamPoint[],
  maxHr?: number,
): HrZone[] {
  const hrPoints = streams.filter((p) => p.hr !== null && p.hr > 0)
  if (hrPoints.length < 2) return []

  // Estimate max HR from data if not provided — note: per-activity estimation
  // is unreliable for easy runs. Prefer passing a global max HR.
  const estimatedMax = maxHr ?? Math.max(...hrPoints.map((p) => p.hr!)) * 1.05

  const zones = HR_ZONE_LABELS.map((label, i) => ({
    label,
    min: Math.round(estimatedMax * HR_ZONE_PCTS[i][0]),
    max: Math.round(estimatedMax * HR_ZONE_PCTS[i][1]),
  }))

  // Count time in each zone (each point represents a time interval)
  const zoneCounts = [0, 0, 0, 0, 0]
  for (let i = 0; i < hrPoints.length; i++) {
    const hr = hrPoints[i].hr!
    const interval =
      i < hrPoints.length - 1
        ? hrPoints[i + 1].time - hrPoints[i].time
        : i > 0
          ? hrPoints[i].time - hrPoints[i - 1].time
          : 1

    if (hr < zones[1].min) zoneCounts[0] += interval
    else if (hr < zones[2].min) zoneCounts[1] += interval
    else if (hr < zones[3].min) zoneCounts[2] += interval
    else if (hr < zones[4].min) zoneCounts[3] += interval
    else zoneCounts[4] += interval
  }

  const total = zoneCounts.reduce((s, c) => s + c, 0)

  return zones.map((z, i) => ({
    zone: i + 1,
    label: z.label,
    min: z.min,
    max: z.max,
    seconds: zoneCounts[i],
    percentage: total > 0 ? Math.round((zoneCounts[i] / total) * 100) : 0,
    color: HR_ZONE_COLORS[i],
  }))
}

// ---- 3.6 Pace Zone Analysis ----

export interface PaceZone {
  zone: number
  label: string
  min_pace: number  // min/km (lower = faster)
  max_pace: number  // min/km (higher = slower)
  seconds: number
  percentage: number
  color: string
}

const PACE_ZONE_COLORS = [
  "var(--chart-5)", // Sprint
  "var(--chart-3)", // Interval
  "var(--chart-1)", // Tempo
  "var(--chart-4)", // Easy
  "var(--chart-2)", // Recovery
]

/**
 * Analyzes pace distribution from stream data.
 * Categories: Recovery (>6:30), Easy (5:30-6:30), Tempo (4:30-5:30),
 * Interval (3:30-4:30), Sprint (<3:30) — adjusted based on average pace.
 */
export function analyzePaceZones(streams: StreamPoint[]): PaceZone[] {
  const pacePoints = streams.filter((p) => p.pace !== null && p.pace > 0 && p.pace < 15)
  if (pacePoints.length < 2) return []

  // Calculate average pace to set relative zones
  const avgPace =
    pacePoints.reduce((s, p) => s + p.pace!, 0) / pacePoints.length

  // Define zones relative to this activity's average pace
  // Labels reflect relative effort within the run, not absolute training zones
  const zones: { label: string; min: number; max: number }[] = [
    { label: "Much faster", min: 0, max: avgPace * 0.7 },
    { label: "Faster", min: avgPace * 0.7, max: avgPace * 0.85 },
    { label: "Above avg", min: avgPace * 0.85, max: avgPace * 1.0 },
    { label: "Below avg", min: avgPace * 1.0, max: avgPace * 1.2 },
    { label: "Much slower", min: avgPace * 1.2, max: 99 },
  ]

  const zoneCounts = [0, 0, 0, 0, 0]
  for (let i = 0; i < pacePoints.length; i++) {
    const pace = pacePoints[i].pace!
    const interval =
      i < pacePoints.length - 1
        ? pacePoints[i + 1].time - pacePoints[i].time
        : i > 0
          ? pacePoints[i].time - pacePoints[i - 1].time
          : 1

    if (pace < zones[0].max) zoneCounts[0] += interval
    else if (pace < zones[1].max) zoneCounts[1] += interval
    else if (pace < zones[2].max) zoneCounts[2] += interval
    else if (pace < zones[3].max) zoneCounts[3] += interval
    else zoneCounts[4] += interval
  }

  const total = zoneCounts.reduce((s, c) => s + c, 0)

  return zones.map((z, i) => ({
    zone: i + 1,
    label: z.label,
    min_pace: z.min,
    max_pace: z.max,
    seconds: zoneCounts[i],
    percentage: total > 0 ? Math.round((zoneCounts[i] / total) * 100) : 0,
    color: PACE_ZONE_COLORS[i],
  }))
}
