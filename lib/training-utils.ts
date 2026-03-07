import type { Activity, StreamPoint } from "@/lib/types"

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

    // Best = smallest pace-adjusted time for exactly the standard distance
    let best = qualifying[0]
    let bestTime = (km / best.distance_km) * best.duration_seconds

    for (const a of qualifying) {
      const adjusted = (km / a.distance_km) * a.duration_seconds
      if (adjusted < bestTime) {
        best = a
        bestTime = adjusted
      }
    }

    records.push({
      distance_label: label,
      distance_km: km,
      time_seconds: Math.round(bestTime),
      pace_min_per_km: bestTime / 60 / km,
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
  risk: "low" | "moderate" | "high"
}

/**
 * Computes Acute:Chronic Workload Ratio.
 * Acute = last 7 days distance. Chronic = 28-day average weekly distance.
 * Risk: <0.8 = low (underprepared), 0.8-1.3 = low (sweet spot), 1.3-1.5 = moderate, >1.5 = high.
 */
export function computeACWR(activities: Activity[]): AcwrResult {
  const now = Date.now()
  const day7 = now - 7 * 24 * 60 * 60 * 1000
  const day28 = now - 28 * 24 * 60 * 60 * 1000

  const acuteLoad = activities
    .filter((a) => new Date(a.date).getTime() >= day7)
    .reduce((s, a) => s + a.distance_km, 0)

  const chronicTotal = activities
    .filter((a) => new Date(a.date).getTime() >= day28)
    .reduce((s, a) => s + a.distance_km, 0)

  const chronicLoad = chronicTotal / 4 // 4 weeks average

  const ratio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0

  let risk: AcwrResult["risk"] = "low"
  if (ratio > 1.5) risk = "high"
  else if (ratio > 1.3) risk = "moderate"

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
 * ATL decay constant = 7 days, CTL decay constant = 42 days.
 * Returns the last 90 days of data points.
 */
export function computeTrainingLoad(activities: Activity[]): TrainingLoadPoint[] {
  if (activities.length === 0) return []

  // Build daily distance map for the last 120 days (buffer for EWMA warmup)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const startDays = 120
  const outputDays = 90

  const dailyLoad = new Map<string, number>()
  for (const a of activities) {
    const d = a.date.split("T")[0]
    dailyLoad.set(d, (dailyLoad.get(d) ?? 0) + a.distance_km)
  }

  const points: TrainingLoadPoint[] = []
  const atlDecay = 2 / (7 + 1)
  const ctlDecay = 2 / (42 + 1)

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
}

const PREDICTION_DISTANCES = [
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
] as const

/**
 * Predicts race times using the Riegel formula:
 * T2 = T1 * (D2 / D1)^1.06
 *
 * Uses the best recent activity (last 90 days, >= 3km) as the reference.
 */
export function predictRaceTimes(activities: Activity[]): {
  predictions: RacePrediction[]
  referenceActivity: Activity | null
} {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recent = activities.filter(
    (a) =>
      new Date(a.date).getTime() >= cutoff &&
      a.distance_km >= 3 &&
      a.duration_seconds > 0,
  )

  if (recent.length === 0) return { predictions: [], referenceActivity: null }

  // Find best "VDOT" equivalent — fastest pace-adjusted 5k equivalent
  let bestRef = recent[0]
  let bestEquiv = (5 / bestRef.distance_km) ** 1.06 * bestRef.duration_seconds

  for (const a of recent) {
    const equiv = (5 / a.distance_km) ** 1.06 * a.duration_seconds
    if (equiv < bestEquiv) {
      bestRef = a
      bestEquiv = equiv
    }
  }

  const predictions: RacePrediction[] = PREDICTION_DISTANCES.map(({ label, km }) => ({
    distance_label: label,
    distance_km: km,
    predicted_seconds: Math.round(
      bestRef.duration_seconds * (km / bestRef.distance_km) ** 1.06,
    ),
  }))

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

  const zones: { label: string; min: number; max: number }[] = [
    { label: "Recovery", min: 0, max: Math.round(estimatedMax * 0.6) },
    { label: "Aerobic", min: Math.round(estimatedMax * 0.6), max: Math.round(estimatedMax * 0.7) },
    { label: "Tempo", min: Math.round(estimatedMax * 0.7), max: Math.round(estimatedMax * 0.8) },
    { label: "Threshold", min: Math.round(estimatedMax * 0.8), max: Math.round(estimatedMax * 0.9) },
    { label: "VO2 Max", min: Math.round(estimatedMax * 0.9), max: Math.round(estimatedMax) },
  ]

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
