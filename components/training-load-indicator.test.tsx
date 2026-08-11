// @vitest-environment jsdom

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { I18nProvider } from "@/lib/i18n"
import { TrainingLoadIndicator } from "./training-load-indicator"
import type { Activity } from "@/lib/types"
import type { Warning } from "@/lib/training-warnings"

/**
 * The card's job is to never state a number the engine did not measure, so
 * these tests are mostly about what is ABSENT: no meter without a baseline, no
 * "Normal" fatigue from a comparison that never ran, no level from a fallback.
 *
 * They assert on rendered text rather than on props, because every bug this
 * file exists for survived a passing type check.
 */

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: daysAgo(1),
    distance_km: 10,
    duration_seconds: 3600,
    pace_min_per_km: 6,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: daysAgo(1),
    ...overrides,
  }
}

/** A steady base: `weeks` weeks of `perWeek` runs, most recent first. */
function steadyBase(weeks: number, perWeek: number, kmEach: number): Activity[] {
  const acts: Activity[] = []
  for (let w = 0; w < weeks; w++) {
    for (let s = 0; s < perWeek; s++) {
      acts.push(makeActivity({ date: daysAgo(w * 7 + s + 1), distance_km: kmEach }))
    }
  }
  return acts
}

/** Real history, but nothing in the last four weeks — chronic load is zero. */
function lapsedBase(): Activity[] {
  const acts: Activity[] = []
  for (let d = 30; d <= 60; d += 3) acts.push(makeActivity({ date: daysAgo(d), distance_km: 8 }))
  return acts
}

function renderCard(ui: ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>)
}

const meter = () => screen.queryByRole("progressbar")

describe("TrainingLoadIndicator — gating", () => {
  it("renders nothing below the minimum run count", () => {
    const { container } = renderCard(
      <TrainingLoadIndicator activities={steadyBase(1, 3, 8)} />,
    )
    expect(container.innerHTML).toBe("")
  })

  it("ignores non-run activities when counting history", () => {
    const rides = Array.from({ length: 10 }, (_, i) =>
      makeActivity({ type: "Ride", date: daysAgo(i + 1) }),
    )
    const { container } = renderCard(<TrainingLoadIndicator activities={rides} />)
    expect(container.innerHTML).toBe("")
  })
})

describe("TrainingLoadIndicator — no baseline", () => {
  it("explains what is missing instead of showing a load of zero", () => {
    renderCard(<TrainingLoadIndicator activities={lapsedBase()} />)

    expect(screen.getByText("Building Baseline")).toBeTruthy()
    expect(screen.getByText(/no baseline to measure today against/i)).toBeTruthy()
    // The three values that used to be defaults dressed as findings.
    expect(meter()).toBeNull()
    expect(screen.queryByText("Fatigue")).toBeNull()
    expect(screen.queryByText("Level")).toBeNull()
    expect(screen.queryByText("Beginner")).toBeNull()
  })

  it("says when the runner last ran", () => {
    renderCard(<TrainingLoadIndicator activities={lapsedBase()} />)
    expect(screen.getByText("Last run")).toBeTruthy()
  })
})

describe("TrainingLoadIndicator — unknown vs measured", () => {
  it("does not claim fatigue is normal when there were too few runs to compare", () => {
    // Five runs: enough for a baseline and a meter, short of the eight the
    // fatigue comparison needs.
    const acts = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeActivity({ date: daysAgo(i * 4 + 1), distance_km: 8 }),
      ),
    ]
    renderCard(<TrainingLoadIndicator activities={acts} />)

    expect(meter()).toBeTruthy()
    expect(screen.getByText("Not enough data")).toBeTruthy()
    expect(screen.queryByText("Normal")).toBeNull()
  })

  it("reports a genuine 'Normal' once the comparison actually ran", () => {
    const acts = Array.from({ length: 12 }, (_, i) =>
      makeActivity({ date: daysAgo(i + 1), distance_km: 8, avg_heart_rate: 140 }),
    )
    renderCard(<TrainingLoadIndicator activities={acts} />)
    expect(screen.getByText("Normal")).toBeTruthy()
  })

  it("does not present the beginner fallback as a classification", () => {
    // Two runs inside the classification window, the rest long outside it.
    const acts = [
      makeActivity({ date: daysAgo(2), distance_km: 8 }),
      makeActivity({ date: daysAgo(5), distance_km: 8 }),
      makeActivity({ date: daysAgo(200), distance_km: 8 }),
      makeActivity({ date: daysAgo(210), distance_km: 8 }),
    ]
    renderCard(<TrainingLoadIndicator activities={acts} />)
    expect(screen.queryByText("Beginner")).toBeNull()
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0)
  })
})

describe("TrainingLoadIndicator — the load reading", () => {
  it("shows the ratio rather than a score out of a hundred", () => {
    renderCard(<TrainingLoadIndicator activities={steadyBase(6, 4, 10)} />)
    expect(screen.getByText(/^\d+\.\d{2}× baseline$/)).toBeTruthy()
    expect(screen.queryByText(/\/ 100/)).toBeNull()
  })

  it("keeps the true ratio readable when the bar is clamped", () => {
    // Tiny chronic base, large acute week → ACWR well past the unsafe cap.
    const acts = [
      ...Array.from({ length: 7 }, (_, i) => makeActivity({ date: daysAgo(i + 1), distance_km: 12 })),
      makeActivity({ date: daysAgo(25), distance_km: 5 }),
    ]
    renderCard(<TrainingLoadIndicator activities={acts} />)

    expect(meter()!.getAttribute("aria-valuenow")).toBe("100")
    const valueText = meter()!.getAttribute("aria-valuetext") ?? ""
    const ratio = Number(valueText.match(/^(\d+\.\d{2})×/)?.[1])
    expect(ratio).toBeGreaterThan(1.5)
  })

  it("labels the scale from the thresholds it names", () => {
    renderCard(<TrainingLoadIndicator activities={steadyBase(6, 4, 10)} />)
    // The optimal label sits over the band rather than at the bar's midpoint.
    const optimal = screen.getByText("Optimal", { selector: "span.absolute" })
    expect(optimal.style.left).toBe("70%")
  })
})

describe("TrainingLoadIndicator — warnings", () => {
  const warning: Warning = {
    type: "elevated_acwr",
    severity: "critical",
    titleKey: "warning.elevated_acwr.title",
    messageKey: "warning.elevated_acwr.messageCritical",
    params: { acwr: "1.62" },
    triggeredAt: new Date().toISOString(),
  }

  it("resolves warning keys through the dictionary and fills in their values", () => {
    renderCard(
      <TrainingLoadIndicator activities={steadyBase(6, 4, 10)} warnings={[warning]} />,
    )
    expect(screen.getByText("Training load is climbing fast")).toBeTruthy()
    // Interpolated, not left as a raw {acwr} placeholder.
    expect(screen.getByText(/your recent load is 1\.62× your baseline/i)).toBeTruthy()
    expect(screen.queryByText(/\{acwr\}/)).toBeNull()
  })

  it("offers a dismiss control only when there is somewhere to send it", () => {
    renderCard(
      <TrainingLoadIndicator activities={steadyBase(6, 4, 10)} warnings={[warning]} />,
    )
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull()

    renderCard(
      <TrainingLoadIndicator
        activities={steadyBase(6, 4, 10)}
        warnings={[warning]}
        onDismissWarning={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy()
  })

  it("still lists warnings on a card that has no baseline to show", () => {
    renderCard(<TrainingLoadIndicator activities={lapsedBase()} warnings={[warning]} />)
    expect(screen.getByText("Building Baseline")).toBeTruthy()
    expect(screen.getByText("Training load is climbing fast")).toBeTruthy()
  })
})

describe("TrainingLoadIndicator — compact", () => {
  it("renders the status label alone", () => {
    renderCard(<TrainingLoadIndicator activities={steadyBase(6, 4, 10)} compact />)
    expect(meter()).toBeNull()
    expect(screen.queryByText("Fatigue")).toBeNull()
  })
})
