// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { InsightsScreen } from "./insights-screen"
import type { Activity } from "@/lib/types"

/**
 * Personal records.
 *
 * A record is a specific run on a specific day, and the row already shows its
 * date and pace — but it was the one list in the app that went nowhere when
 * tapped.
 */

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Morning Run",
    date: "2026-02-26",
    distance_km: 5,
    duration_seconds: 1642,
    pace_min_per_km: 5.47,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: "2026-02-26",
    ...overrides,
  }
}

function renderInsights(activities: Activity[], onSelectActivity?: (a: Activity) => void) {
  return render(
    <I18nProvider>
      <InsightsScreen activities={activities} goals={[]} onSelectActivity={onSelectActivity} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ test_runs: [] }) })),
  )
})

describe("InsightsScreen — personal records", () => {
  it("opens the run behind a record", () => {
    const onSelectActivity = vi.fn()
    const best = makeActivity({ distance_km: 5, duration_seconds: 1642 })
    const slower = makeActivity({ distance_km: 5, duration_seconds: 1900 })
    renderInsights([best, slower], onSelectActivity)

    fireEvent.click(screen.getByRole("button", { name: /5 km/ }))
    expect(onSelectActivity).toHaveBeenCalledTimes(1)
    // The record's own run, not merely the first of the qualifying ones.
    expect(onSelectActivity).toHaveBeenCalledWith(best)
  })

  it("keeps the record readable when there is nowhere to send it", () => {
    renderInsights([makeActivity()])
    expect(screen.getByText("5 km")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /5 km/ })).toBeNull()
  })
})
