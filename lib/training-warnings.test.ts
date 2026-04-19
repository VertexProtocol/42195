import { describe, it, expect } from "vitest"
import {
  evaluateWarnings,
  buildWarningContext,
  countActiveWarnings,
  deriveWarningContext,
  type WarningActivity,
  type WarningContext,
  type WarningState,
} from "./training-warnings"

const REF = new Date("2026-04-19T12:00:00Z")
const DAY_MS = 24 * 60 * 60 * 1000

const HEALTHY: WarningContext = {
  acwr: 1.0,
  acwrOneWeekAgo: 1.0,
  fatigueSignal: "none",
  tsbBelowThresholdWeeks: 0,
}

describe("evaluateWarnings — no signals", () => {
  it("returns no warnings when everything is normal", () => {
    const r = evaluateWarnings(HEALTHY, {}, REF)
    expect(r.newWarnings).toHaveLength(0)
    expect(r.nextState).toEqual({})
  })
})

describe("evaluateWarnings — elevated ACWR", () => {
  it("does not surface a one-week spike (ACWR elevated now, normal before)", () => {
    const ctx: WarningContext = { ...HEALTHY, acwr: 1.4, acwrOneWeekAgo: 1.1 }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(0)
  })

  it("surfaces when ACWR has been elevated for two consecutive weeks", () => {
    const ctx: WarningContext = { ...HEALTHY, acwr: 1.4, acwrOneWeekAgo: 1.35 }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(1)
    expect(r.newWarnings[0].type).toBe("elevated_acwr")
    expect(r.newWarnings[0].severity).toBe("warn")
    expect(r.nextState.elevated_acwr?.lastSurfacedAt).toBe(REF.toISOString())
  })

  it("uses critical severity when ACWR is above the unsafe threshold", () => {
    const ctx: WarningContext = { ...HEALTHY, acwr: 1.6, acwrOneWeekAgo: 1.4 }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings[0].severity).toBe("critical")
    expect(r.newWarnings[0].message).toContain("injury risk")
  })

  it("respects cooldown — does not re-surface within 14 days", () => {
    const state: WarningState = {
      elevated_acwr: {
        lastSurfacedAt: new Date(REF.getTime() - 10 * DAY_MS).toISOString(),
      },
    }
    const ctx: WarningContext = { ...HEALTHY, acwr: 1.5, acwrOneWeekAgo: 1.4 }
    const r = evaluateWarnings(ctx, state, REF)
    expect(r.newWarnings).toHaveLength(0)
    // State is unchanged (cooldown prevents re-surfacing)
    expect(r.nextState.elevated_acwr?.lastSurfacedAt).toBe(state.elevated_acwr!.lastSurfacedAt)
  })

  it("re-surfaces after the cooldown expires", () => {
    const state: WarningState = {
      elevated_acwr: {
        lastSurfacedAt: new Date(REF.getTime() - 20 * DAY_MS).toISOString(),
      },
    }
    const ctx: WarningContext = { ...HEALTHY, acwr: 1.5, acwrOneWeekAgo: 1.4 }
    const r = evaluateWarnings(ctx, state, REF)
    expect(r.newWarnings).toHaveLength(1)
    expect(r.nextState.elevated_acwr?.lastSurfacedAt).toBe(REF.toISOString())
  })
})

describe("evaluateWarnings — prolonged fatigue", () => {
  it("does not surface below the minimum consecutive weeks threshold", () => {
    const ctx: WarningContext = { ...HEALTHY, tsbBelowThresholdWeeks: 2 }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(0)
  })

  it("surfaces when fatigue has persisted for 3+ weeks", () => {
    const ctx: WarningContext = { ...HEALTHY, tsbBelowThresholdWeeks: 3 }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(1)
    expect(r.newWarnings[0].type).toBe("prolonged_fatigue")
    expect(r.newWarnings[0].severity).toBe("critical")
    expect(r.newWarnings[0].message).toContain("3 straight weeks")
  })

  it("respects cooldown for prolonged fatigue", () => {
    const state: WarningState = {
      prolonged_fatigue: {
        lastSurfacedAt: new Date(REF.getTime() - 5 * DAY_MS).toISOString(),
      },
    }
    const ctx: WarningContext = { ...HEALTHY, tsbBelowThresholdWeeks: 4 }
    const r = evaluateWarnings(ctx, state, REF)
    expect(r.newWarnings).toHaveLength(0)
  })
})

describe("evaluateWarnings — HR drift", () => {
  it("surfaces on 'hr_elevated' signal", () => {
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "hr_elevated" }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(1)
    expect(r.newWarnings[0].type).toBe("hr_drift")
    expect(r.newWarnings[0].severity).toBe("warn")
  })

  it("surfaces on 'both' signal and emits both hr_drift AND pace_drift", () => {
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "both" }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(2)
    const types = r.newWarnings.map((w) => w.type).sort()
    expect(types).toEqual(["hr_drift", "pace_drift"])
    // 'both' signal escalates to critical
    expect(r.newWarnings.find((w) => w.type === "hr_drift")!.severity).toBe("critical")
  })

  it("does not surface on 'none'", () => {
    const r = evaluateWarnings(HEALTHY, {}, REF)
    expect(r.newWarnings).toHaveLength(0)
  })

  it("respects cooldown for hr_drift", () => {
    const state: WarningState = {
      hr_drift: {
        lastSurfacedAt: new Date(REF.getTime() - 7 * DAY_MS).toISOString(),
      },
    }
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "hr_elevated" }
    const r = evaluateWarnings(ctx, state, REF)
    expect(r.newWarnings).toHaveLength(0)
  })
})

describe("evaluateWarnings — pace drift", () => {
  it("surfaces on 'pace_declining'", () => {
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "pace_declining" }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.newWarnings).toHaveLength(1)
    expect(r.newWarnings[0].type).toBe("pace_drift")
    expect(r.newWarnings[0].severity).toBe("warn")
  })
})

describe("evaluateWarnings — combined signals", () => {
  it("emits multiple warnings at once when several conditions are met", () => {
    const ctx: WarningContext = {
      acwr: 1.6,
      acwrOneWeekAgo: 1.4,
      fatigueSignal: "both",
      tsbBelowThresholdWeeks: 4,
    }
    const r = evaluateWarnings(ctx, {}, REF)
    const types = r.newWarnings.map((w) => w.type).sort()
    expect(types).toEqual(["elevated_acwr", "hr_drift", "pace_drift", "prolonged_fatigue"])
  })

  it("only updates state for types that actually surfaced", () => {
    // ACWR is not persistent enough, fatigue is present
    const ctx: WarningContext = {
      acwr: 1.4,
      acwrOneWeekAgo: 1.1,
      fatigueSignal: "hr_elevated",
      tsbBelowThresholdWeeks: 0,
    }
    const r = evaluateWarnings(ctx, {}, REF)
    expect(r.nextState.elevated_acwr).toBeUndefined()
    expect(r.nextState.hr_drift).toBeDefined()
  })

  it("custom cooldownDays override is respected", () => {
    const state: WarningState = {
      hr_drift: {
        lastSurfacedAt: new Date(REF.getTime() - 5 * DAY_MS).toISOString(),
      },
    }
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "hr_elevated" }
    // cooldownDays=3 → 5 days since last surfaced > 3 → can surface again
    const r = evaluateWarnings(ctx, state, REF, { cooldownDays: 3 })
    expect(r.newWarnings).toHaveLength(1)
  })
})

describe("buildWarningContext", () => {
  it("wires the input fields through unchanged", () => {
    const ctx = buildWarningContext({
      currentAcwr: 1.4,
      acwrOneWeekAgo: 1.2,
      fatigueSignal: "hr_elevated",
      tsbBelowThresholdWeeks: 2,
    })
    expect(ctx).toEqual({
      acwr: 1.4,
      acwrOneWeekAgo: 1.2,
      fatigueSignal: "hr_elevated",
      tsbBelowThresholdWeeks: 2,
    })
  })
})

describe("countActiveWarnings", () => {
  it("returns the length of the warning array", () => {
    expect(countActiveWarnings([])).toBe(0)
    const ctx: WarningContext = { ...HEALTHY, fatigueSignal: "both" }
    const { newWarnings } = evaluateWarnings(ctx, {}, REF)
    expect(countActiveWarnings(newWarnings)).toBe(2)
  })
})

describe("deriveWarningContext", () => {
  function activity(
    daysAgo: number,
    km: number,
    overrides: Partial<WarningActivity> = {},
  ): WarningActivity {
    return {
      date: new Date(REF.getTime() - daysAgo * DAY_MS).toISOString(),
      distance_km: km,
      duration_seconds: km * 6 * 60, // 6 min/km default
      pace_min_per_km: 6,
      avg_heart_rate: 150,
      elevation_gain_m: 0,
      ...overrides,
    }
  }

  it("returns zeros when there's no activity history", () => {
    const ctx = deriveWarningContext([], REF)
    expect(ctx.acwr).toBe(0)
    expect(ctx.acwrOneWeekAgo).toBe(0)
    expect(ctx.fatigueSignal).toBe("none")
    expect(ctx.tsbBelowThresholdWeeks).toBe(0)
  })

  it("computes non-zero ACWR when there are runs in both windows", () => {
    // Steady 10 km/run, 3 runs/week for 6 weeks → balanced ACWR near 1.0
    const acts: WarningActivity[] = []
    for (let week = 0; week < 6; week++) {
      for (const d of [1, 3, 5]) {
        acts.push(activity(week * 7 + d, 10))
      }
    }
    const ctx = deriveWarningContext(acts, REF)
    expect(ctx.acwr).toBeGreaterThan(0)
    expect(ctx.acwrOneWeekAgo).toBeGreaterThan(0)
  })

  it("flags fatigue when recent HR is clearly elevated vs baseline", () => {
    // 8 baseline runs at 140 bpm, then 4 recent runs at 160 bpm
    const acts: WarningActivity[] = []
    for (let i = 0; i < 4; i++) {
      acts.push(activity(i + 1, 6, { avg_heart_rate: 160 }))
    }
    for (let i = 0; i < 8; i++) {
      acts.push(activity(10 + i * 2, 6, { avg_heart_rate: 140 }))
    }
    const ctx = deriveWarningContext(acts, REF)
    expect(["hr_elevated", "both"]).toContain(ctx.fatigueSignal)
  })
})
