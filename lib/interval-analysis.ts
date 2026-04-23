import type { Activity, Lap, StreamPoint } from "./types"

// ─── Types ────────────────────────────────────────────────────────────────

export type SegmentType = "warmup" | "work" | "cooldown"
export type IntensityLevel = "easy" | "moderate" | "tempo" | "hard" | "max"
export type WorkoutPattern = "intervals" | "progression" | "pyramid" | "steady" | "mixed"

export interface Segment {
  index: number
  type: SegmentType
  intensity: IntensityLevel
  durationSeconds: number
  distanceKm: number
  avgPaceMinPerKm: number | null
  avgHeartRate: number | null
  peakHeartRate: number | null
}

export interface IntervalAnalysis {
  /** True when we found enough structure to call this an interval workout */
  detected: boolean
  /** Plain-English explanation suitable for display when detected is false */
  reason: string
  /** Which data source we used to segment the activity */
  source: "laps" | "streams" | "none"
  pattern: WorkoutPattern
  segments: Segment[]
  totalRestSeconds: number
  /** Spread between the fastest and slowest work segment, in seconds/km */
  paceSpreadSec: number | null
  consistencyLabel: "even" | "moderate" | "variable" | null
}

// ─── Tunables ─────────────────────────────────────────────────────────────

/** Time gap in the streams that counts as a pause */
const PAUSE_GAP_SEC = 20
/** Minimum work segments before we call something "intervals" */
const MIN_WORK_SEGMENTS = 2
/** Minimum distance for a segment to be counted as a real effort (km) */
const MIN_WORK_DISTANCE_KM = 0.1
/** CV threshold to treat Strava laps as manual (vs auto-lap at fixed intervals) */
const LAP_DISTANCE_CV_THRESHOLD = 0.1

// ─── Source picking ───────────────────────────────────────────────────────

/**
 * Strava laps can be either:
 *   (a) manual lap-button presses (distances vary — good interval signal)
 *   (b) auto-lap at a fixed trigger like every 1 km (distances essentially identical)
 *
 * If distances vary meaningfully (coefficient of variation above threshold),
 * we treat them as manual and use them as-is. Otherwise we fall through to
 * stream-based pause detection.
 */
function lapsLookManual(laps: Lap[]): boolean {
  if (laps.length < 2) return false
  const distances = laps.map((l) => l.distance_km).filter((d) => d > 0)
  if (distances.length < 2) return false
  const mean = distances.reduce((s, d) => s + d, 0) / distances.length
  if (mean <= 0) return false
  const variance = distances.reduce((s, d) => s + (d - mean) ** 2, 0) / distances.length
  const cv = Math.sqrt(variance) / mean
  return cv > LAP_DISTANCE_CV_THRESHOLD
}

// ─── Stream-based pause detection ─────────────────────────────────────────

interface RawSegment {
  startTime: number
  endTime: number
  points: StreamPoint[]
}

/**
 * Splits stream data into active segments divided by pauses. A pause is
 * detected as a timestamp jump larger than PAUSE_GAP_SEC between consecutive
 * samples — this is how Strava encodes watch-pause periods in its stream data.
 */
function segmentStreamsByPauses(streams: StreamPoint[]): RawSegment[] {
  if (streams.length === 0) return []
  const segments: RawSegment[] = []
  let current: StreamPoint[] = [streams[0]]
  for (let i = 1; i < streams.length; i++) {
    const prev = streams[i - 1]
    const curr = streams[i]
    const gap = curr.time - prev.time
    if (gap > PAUSE_GAP_SEC) {
      if (current.length > 0) {
        segments.push({ startTime: current[0].time, endTime: prev.time, points: current })
      }
      current = [curr]
    } else {
      current.push(curr)
    }
  }
  if (current.length > 0) {
    const last = current[current.length - 1]
    segments.push({ startTime: current[0].time, endTime: last.time, points: current })
  }
  return segments
}

/** Average a numeric field, skipping nulls/zeros for HR and nulls for pace */
function avg(xs: (number | null | undefined)[], skipZero = false): number | null {
  const filtered = xs.filter((x): x is number =>
    x !== null && x !== undefined && !Number.isNaN(x) && (!skipZero || x > 0),
  )
  if (filtered.length === 0) return null
  return filtered.reduce((s, x) => s + x, 0) / filtered.length
}

function max(xs: (number | null | undefined)[]): number | null {
  let m: number | null = null
  for (const x of xs) {
    if (x !== null && x !== undefined && !Number.isNaN(x)) {
      if (m === null || x > m) m = x
    }
  }
  return m
}

function rawSegmentToSegment(
  raw: RawSegment,
  index: number,
  activityDistanceKm: number,
  activityDurationSec: number,
): Segment {
  const duration = raw.endTime - raw.startTime
  // Pace is min/km in streams. Low values (< 2) are GPS glitches while stopped.
  const paces = raw.points.map((p) => (p.pace && p.pace >= 2 && p.pace <= 20 ? p.pace : null))
  const avgPace = avg(paces)
  const hrs = raw.points.map((p) => p.hr)
  const avgHr = avg(hrs, true)
  const peakHr = max(hrs)
  // Distance estimate: duration × pace. Fall back to proportional share of
  // total distance if pace is missing.
  let distanceKm: number
  if (avgPace && avgPace > 0) {
    distanceKm = duration / (avgPace * 60)
  } else {
    distanceKm = activityDurationSec > 0
      ? (duration / activityDurationSec) * activityDistanceKm
      : 0
  }
  return {
    index,
    type: "work", // overwritten by classifier
    intensity: "moderate", // overwritten by classifier
    durationSeconds: duration,
    distanceKm: Number(distanceKm.toFixed(3)),
    avgPaceMinPerKm: avgPace ? Number(avgPace.toFixed(2)) : null,
    avgHeartRate: avgHr ? Math.round(avgHr) : null,
    peakHeartRate: peakHr,
  }
}

// ─── Lap-based segmenting ─────────────────────────────────────────────────

function lapToSegment(lap: Lap, index: number): Segment {
  return {
    index,
    type: "work",
    intensity: "moderate",
    durationSeconds: lap.duration_seconds,
    distanceKm: lap.distance_km,
    avgPaceMinPerKm: lap.pace_min_per_km ?? null,
    avgHeartRate: lap.avg_heart_rate ?? null,
    peakHeartRate: lap.avg_heart_rate ?? null,
  }
}

// ─── Classification ───────────────────────────────────────────────────────

/** Classify intensity from HR-% if we have max HR, else fall back to pace quartiles. */
function classifyIntensity(
  segments: Segment[],
  maxHr: number | null,
): IntensityLevel[] {
  // HR-based: map avg HR as % of max to zones
  if (maxHr && segments.every((s) => s.avgHeartRate != null)) {
    return segments.map((s) => {
      const pct = (s.avgHeartRate! / maxHr) * 100
      if (pct < 65) return "easy"
      if (pct < 77) return "moderate"
      if (pct < 87) return "tempo"
      if (pct < 94) return "hard"
      return "max"
    })
  }
  // Pace-based fallback: rank segments by pace (lower is faster)
  const paces = segments.map((s) => s.avgPaceMinPerKm).filter((p): p is number => p != null)
  if (paces.length < 2) return segments.map(() => "moderate")
  const sorted = [...paces].sort((a, b) => a - b)
  const p25 = sorted[Math.floor(sorted.length * 0.25)]
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p75 = sorted[Math.floor(sorted.length * 0.75)]
  return segments.map((s) => {
    if (s.avgPaceMinPerKm == null) return "moderate"
    if (s.avgPaceMinPerKm <= p25) return "hard"
    if (s.avgPaceMinPerKm <= p50) return "tempo"
    if (s.avgPaceMinPerKm <= p75) return "moderate"
    return "easy"
  })
}

/**
 * Applies warmup/cooldown labels at the endpoints if they look like warmup/cooldown:
 *   • significantly slower than the median pace (>15%), AND
 *   • intensity is "easy" or "moderate" (not tempo/hard/max — those are real reps)
 *
 * Both checks matter. Pace alone would mis-label a cautious opening rep as
 * warmup; HR alone would miss a genuine warmup where HR is still catching up.
 */
function labelSegmentTypes(segments: Segment[]): void {
  if (segments.length < 3) return
  const paces = segments.map((s) => s.avgPaceMinPerKm).filter((p): p is number => p != null)
  if (paces.length < 3) return
  const sorted = [...paces].sort((a, b) => a - b)
  const medianPace = sorted[Math.floor(sorted.length / 2)]

  const isEndpointSlow = (s: Segment) =>
    s.avgPaceMinPerKm != null && s.avgPaceMinPerKm > medianPace * 1.15
  const isLowIntensity = (s: Segment) =>
    s.intensity === "easy" || s.intensity === "moderate"

  const first = segments[0]
  const last = segments[segments.length - 1]

  if (isEndpointSlow(first) && isLowIntensity(first)) first.type = "warmup"
  if (isEndpointSlow(last) && isLowIntensity(last)) last.type = "cooldown"
}

// ─── Pattern detection ────────────────────────────────────────────────────

const INTENSITY_RANK: Record<IntensityLevel, number> = {
  easy: 1, moderate: 2, tempo: 3, hard: 4, max: 5,
}

function detectPattern(workSegments: Segment[]): WorkoutPattern {
  if (workSegments.length < MIN_WORK_SEGMENTS) return "steady"
  const ranks = workSegments.map((s) => INTENSITY_RANK[s.intensity])

  const uniqueRanks = new Set(ranks)
  if (uniqueRanks.size === 1) return "intervals" // all same intensity

  // Monotonically non-decreasing with at least one increase = progression
  const strictlyIncreasing = ranks.every((r, i) => i === 0 || r >= ranks[i - 1])
  const hasIncrease = ranks.some((r, i) => i > 0 && r > ranks[i - 1])
  if (strictlyIncreasing && hasIncrease) return "progression"

  // Pyramid: rises then falls (peak not at the ends)
  const peakIndex = ranks.indexOf(Math.max(...ranks))
  if (peakIndex > 0 && peakIndex < ranks.length - 1) {
    const risesToPeak = ranks.slice(0, peakIndex + 1).every((r, i, a) => i === 0 || r >= a[i - 1])
    const fallsFromPeak = ranks.slice(peakIndex).every((r, i, a) => i === 0 || r <= a[i - 1])
    if (risesToPeak && fallsFromPeak) return "pyramid"
  }

  // Mostly-uniform with small variations: treat as "intervals"
  if (Math.max(...ranks) - Math.min(...ranks) <= 1) return "intervals"

  return "mixed"
}

// ─── Consistency ──────────────────────────────────────────────────────────

function computeConsistency(workSegments: Segment[]): {
  paceSpreadSec: number
  label: "even" | "moderate" | "variable"
} | null {
  const paces = workSegments.map((s) => s.avgPaceMinPerKm).filter((p): p is number => p != null)
  if (paces.length < 2) return null
  const min = Math.min(...paces)
  const max = Math.max(...paces)
  const spreadSec = Math.round((max - min) * 60)
  let label: "even" | "moderate" | "variable"
  if (spreadSec <= 10) label = "even"
  else if (spreadSec <= 25) label = "moderate"
  else label = "variable"
  return { paceSpreadSec: spreadSec, label }
}

// ─── Main entry point ─────────────────────────────────────────────────────

const EMPTY: IntervalAnalysis = {
  detected: false,
  reason: "no-data",
  source: "none",
  pattern: "steady",
  segments: [],
  totalRestSeconds: 0,
  paceSpreadSec: null,
  consistencyLabel: null,
}

export function analyzeIntervals(
  activity: Activity,
  laps: Lap[] | null | undefined,
  streams: StreamPoint[] | null | undefined,
  maxHr: number | null | undefined = null,
): IntervalAnalysis {
  // 1. Pick source
  let segments: Segment[] = []
  let source: IntervalAnalysis["source"] = "none"
  let totalRestSeconds = 0

  if (laps && laps.length >= 2 && lapsLookManual(laps)) {
    segments = laps.map((l, i) => lapToSegment(l, i + 1))
    source = "laps"
  } else if (streams && streams.length > 0) {
    const raw = segmentStreamsByPauses(streams)
    if (raw.length >= 2) {
      segments = raw.map((r, i) =>
        rawSegmentToSegment(r, i + 1, activity.distance_km, activity.duration_seconds),
      )
      // Pause time = total wall-clock − sum of segment durations
      const activeSec = segments.reduce((s, seg) => s + seg.durationSeconds, 0)
      const wallClock = raw[raw.length - 1].endTime - raw[0].startTime
      totalRestSeconds = Math.max(0, wallClock - activeSec)
      source = "streams"
    }
  }

  if (segments.length < 2) {
    return { ...EMPTY, reason: "not-enough-segments" }
  }

  // 2. Drop stubby segments (< MIN_WORK_DISTANCE_KM) — GPS artifacts
  segments = segments.filter((s) => s.distanceKm >= MIN_WORK_DISTANCE_KM)
  if (segments.length < 2) {
    return { ...EMPTY, reason: "not-enough-segments" }
  }

  // 3. Classify each segment's intensity
  const intensities = classifyIntensity(segments, maxHr ?? null)
  segments.forEach((s, i) => { s.intensity = intensities[i] })

  // 4. Label warmup/cooldown on endpoints when they look the part
  labelSegmentTypes(segments)

  const workSegments = segments.filter((s) => s.type === "work")
  if (workSegments.length < MIN_WORK_SEGMENTS) {
    return {
      ...EMPTY,
      reason: "too-few-work-segments",
      source,
      segments,
      totalRestSeconds,
    }
  }

  // 5. Detect pattern + consistency
  const pattern = detectPattern(workSegments)
  const consistency = computeConsistency(workSegments)

  return {
    detected: true,
    reason: "ok",
    source,
    pattern,
    segments,
    totalRestSeconds,
    paceSpreadSec: consistency?.paceSpreadSec ?? null,
    consistencyLabel: consistency?.label ?? null,
  }
}
