import { describe, it, expect } from "vitest"
import { analyzeIntervals } from "./interval-analysis"
import type { Activity, Lap, StreamPoint } from "./types"

const mockActivity = (overrides: Partial<Activity> = {}): Activity => ({
  id: "a",
  user_id: "u",
  strava_id: null,
  type: "Run",
  name: "Test",
  date: "2026-01-01T00:00:00Z",
  distance_km: 5,
  duration_seconds: 1800,
  pace_min_per_km: 6,
  elevation_gain_m: 0,
  avg_heart_rate: 150,
  avg_cadence: null,
  calories: null,
  map_polyline: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
})

describe("analyzeIntervals", () => {
  describe("source picking", () => {
    it("uses laps when distances vary (manual lap-button presses)", () => {
      const laps: Lap[] = [
        { index: 1, distance_km: 1.5, duration_seconds: 540, pace_min_per_km: 6, avg_heart_rate: 130 },
        { index: 2, distance_km: 0.8, duration_seconds: 192, pace_min_per_km: 4, avg_heart_rate: 170 },
        { index: 3, distance_km: 0.3, duration_seconds: 120, pace_min_per_km: 6.67, avg_heart_rate: 120 },
        { index: 4, distance_km: 0.8, duration_seconds: 200, pace_min_per_km: 4.17, avg_heart_rate: 172 },
      ]
      const result = analyzeIntervals(mockActivity(), laps, null)
      expect(result.source).toBe("laps")
      expect(result.segments).toHaveLength(4)
    })

    it("falls through to streams when laps are uniform auto-laps", () => {
      const laps: Lap[] = Array.from({ length: 5 }, (_, i) => ({
        index: i + 1,
        distance_km: 1.0,
        duration_seconds: 300,
        pace_min_per_km: 5,
        avg_heart_rate: 150,
      }))
      // Dense sampling (every 5s) so we don't trigger false pauses
      const streams: StreamPoint[] = []
      // Segment A: 0–100s
      for (let t = 0; t <= 100; t += 5) {
        streams.push({ time: t, hr: 130 + t / 10, pace: 5, altitude: 100, cadence: 80 })
      }
      // Pause (gap of 120s)
      // Segment B: 220–320s
      for (let t = 220; t <= 320; t += 5) {
        streams.push({ time: t, hr: 160 + (t - 220) / 10, pace: 4, altitude: 100, cadence: 80 })
      }
      const result = analyzeIntervals(mockActivity(), laps, streams)
      expect(result.source).toBe("streams")
    })

    it("returns not-detected when there's neither usable laps nor streams", () => {
      const result = analyzeIntervals(mockActivity(), null, null)
      expect(result.detected).toBe(false)
      expect(result.source).toBe("none")
    })
  })

  describe("pause detection in streams", () => {
    it("splits at time gaps > PAUSE_GAP_SEC", () => {
      const streams: StreamPoint[] = []
      for (let t = 0; t <= 120; t += 5) {
        streams.push({ time: t, hr: 130, pace: 6, altitude: 100, cadence: 80 })
      }
      // 80s gap
      for (let t = 200; t <= 320; t += 5) {
        streams.push({ time: t, hr: 170, pace: 4, altitude: 100, cadence: 80 })
      }
      const result = analyzeIntervals(
        mockActivity({ distance_km: 1, duration_seconds: 240 }),
        null,
        streams,
      )
      expect(result.source).toBe("streams")
      expect(result.segments.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("pattern detection", () => {
    it("recognises a progression pattern", () => {
      // Distances vary enough (CV > 0.1) so laps count as manual
      const laps: Lap[] = [
        { index: 1, distance_km: 1.2, duration_seconds: 360, pace_min_per_km: 5, avg_heart_rate: 140 },
        { index: 2, distance_km: 0.6, duration_seconds: 180, pace_min_per_km: 5, avg_heart_rate: 155 },
        { index: 3, distance_km: 0.8, duration_seconds: 240, pace_min_per_km: 5, avg_heart_rate: 170 },
        { index: 4, distance_km: 0.5, duration_seconds: 150, pace_min_per_km: 5, avg_heart_rate: 185 },
      ]
      const result = analyzeIntervals(mockActivity(), laps, null, 200)
      expect(result.detected).toBe(true)
      expect(result.pattern).toBe("progression")
    })

    it("recognises a pyramid pattern", () => {
      const laps: Lap[] = [
        { index: 1, distance_km: 1.2, duration_seconds: 360, pace_min_per_km: 5, avg_heart_rate: 140 },
        { index: 2, distance_km: 0.6, duration_seconds: 180, pace_min_per_km: 5, avg_heart_rate: 170 },
        { index: 3, distance_km: 0.4, duration_seconds: 120, pace_min_per_km: 5, avg_heart_rate: 190 },
        { index: 4, distance_km: 0.6, duration_seconds: 180, pace_min_per_km: 5, avg_heart_rate: 170 },
        { index: 5, distance_km: 1.2, duration_seconds: 360, pace_min_per_km: 5, avg_heart_rate: 140 },
      ]
      const result = analyzeIntervals(mockActivity(), laps, null, 200)
      expect(result.detected).toBe(true)
      expect(result.pattern).toBe("pyramid")
    })

    it("recognises even intervals (same intensity)", () => {
      const laps: Lap[] = [
        { index: 1, distance_km: 1.2, duration_seconds: 360, pace_min_per_km: 5, avg_heart_rate: 170 },
        { index: 2, distance_km: 0.5, duration_seconds: 150, pace_min_per_km: 5, avg_heart_rate: 172 },
        { index: 3, distance_km: 0.8, duration_seconds: 240, pace_min_per_km: 5, avg_heart_rate: 171 },
      ]
      const result = analyzeIntervals(mockActivity(), laps, null, 200)
      expect(result.detected).toBe(true)
      expect(result.pattern).toBe("intervals")
    })
  })

  describe("real-world data", () => {
    /**
     * Reproduces a real progression workout that shipped on 2026-04-23:
     *   4.36 km · 24:24 moving time · 5 pauses visible in the stream
     * Built from the actual stream data fetched from the user's Supabase.
     */
    it("detects progression from real-world stream data with 5 pauses", () => {
      // Reproduces the user's 2026-04-23 evening run (4.36 km, 24:24 moving,
      // ~11 min in pauses). Sampling is ~7s to match what Strava stores.
      function makeSegment(tStart: number, tEnd: number, hrStart: number, hrEnd: number, pace: number): StreamPoint[] {
        const pts: StreamPoint[] = []
        const step = 7
        const n = Math.floor((tEnd - tStart) / step)
        for (let i = 0; i <= n; i++) {
          const t = tStart + i * step
          const hr = Math.round(hrStart + ((hrEnd - hrStart) * i) / Math.max(1, n))
          pts.push({ time: t, hr, pace, altitude: 175, cadence: 79 })
        }
        return pts
      }
      const streams: StreamPoint[] = [
        ...makeSegment(0, 98, 135, 140, 7.0),         // warmup-ish, slow
        ...makeSegment(192, 458, 107, 154, 6.4),      // rolig
        ...makeSegment(623, 833, 113, 163, 5.85),     // moderat
        ...makeSegment(953, 1156, 117, 174, 5.2),     // tempo
        ...makeSegment(1298, 1515, 129, 188, 4.4),    // hardt
        ...makeSegment(1679, 2113, 132, 179, 5.6),    // avslutning
      ]
      const activity = mockActivity({ distance_km: 4.36, duration_seconds: 1464 })
      const result = analyzeIntervals(activity, null, streams, 190)
      expect(result.detected).toBe(true)
      expect(result.source).toBe("streams")
      expect(result.segments.length).toBeGreaterThanOrEqual(5)
      // Climbing intensity over the reps — progression or pyramid with peak late
      expect(["progression", "pyramid", "mixed"]).toContain(result.pattern)
      // Total rest sums five pauses (94 + 165 + 120 + 142 + 164 ≈ 685s)
      expect(result.totalRestSeconds).toBeGreaterThan(500)
    })
  })
})
