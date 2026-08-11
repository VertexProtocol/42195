// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { ActivitiesScreen } from "./activities-screen"
import type { Activity, SyncStatus } from "@/lib/types"

/**
 * Paging behaviour on the activity log.
 *
 * The step size is counted in steps rather than rows, so the cases worth
 * pinning are the ones where the two could disagree: changing the size after
 * expanding, and changing a filter after expanding.
 */

const SYNC_STATUS: SyncStatus = { state: "success", last_sync_at: null, error_message: null }

function makeActivities(count: number): Activity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `activity-${i}`,
    user_id: "user-1",
    strava_id: null,
    type: i % 5 === 0 ? "Ride" : "Run",
    name: `Session ${i}`,
    date: `2026-0${(i % 9) + 1}-01`,
    distance_km: 10,
    duration_seconds: 3600,
    pace_min_per_km: 6,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: "2026-01-01",
  }))
}

function renderScreen(activities: Activity[]) {
  return render(
    <I18nProvider>
      <ActivitiesScreen
        activities={activities}
        stravaConnected={false}
        syncStatus={SYNC_STATUS}
        testRunActivityIds={new Set()}
        onSelectActivity={() => {}}
        onSync={() => {}}
        onAddActivity={() => {}}
      />
    </I18nProvider>,
  )
}

/** Activity rows, identified by the session name each row's button carries. */
function rowCount(): number {
  return screen.queryAllByRole("button", { name: /Session \d+/ }).length
}

function pageSizeChip(size: number): HTMLElement {
  const group = screen.getByRole("group", { name: /per page/i })
  return within(group).getByRole("button", { name: String(size) })
}

beforeEach(() => {
  localStorage.clear()
})

describe("ActivitiesScreen — page size", () => {
  it("shows one default page of a long log", () => {
    renderScreen(makeActivities(60))
    expect(rowCount()).toBe(25)
  })

  it("adds exactly one more page per tap", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(screen.getByRole("button", { name: /show more/i }))
    expect(rowCount()).toBe(50)
  })

  it("shows fewer rows when a smaller step is chosen", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(10))
    expect(rowCount()).toBe(10)
  })

  it("shows more rows when a larger step is chosen", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(50))
    expect(rowCount()).toBe(50)
  })

  it("collapses an expanded list back to one page of the new size", () => {
    // The regression a row count would invite: expanded to 50 of 25, then
    // switched to 10 — the list must show 10, not stay on a stale 50.
    renderScreen(makeActivities(60))
    fireEvent.click(screen.getByRole("button", { name: /show more/i }))
    expect(rowCount()).toBe(50)

    fireEvent.click(pageSizeChip(10))
    expect(rowCount()).toBe(10)
  })

  it("marks the active step and only that one", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(10))
    expect(pageSizeChip(10).getAttribute("aria-pressed")).toBe("true")
    expect(pageSizeChip(25).getAttribute("aria-pressed")).toBe("false")
    expect(pageSizeChip(50).getAttribute("aria-pressed")).toBe("false")
  })

  it("counts what is rendered, not what was requested", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(10))
    expect(screen.getByText(/^10 of 60$/)).toBeTruthy()
  })
})

describe("ActivitiesScreen — remembering the choice", () => {
  it("stores the chosen step", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(50))
    expect(localStorage.getItem("activities.pageSize")).toBe("50")
  })

  it("opens on the stored step next time", () => {
    localStorage.setItem("activities.pageSize", "10")
    renderScreen(makeActivities(60))
    expect(rowCount()).toBe(10)
    expect(pageSizeChip(10).getAttribute("aria-pressed")).toBe("true")
  })

  it("falls back to the default when the stored value is not one of the options", () => {
    localStorage.setItem("activities.pageSize", "999")
    renderScreen(makeActivities(60))
    expect(rowCount()).toBe(25)
  })
})

describe("ActivitiesScreen — paging against filters", () => {
  it("folds an expanded list back to one page when the filter changes", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(screen.getByRole("button", { name: /show more/i }))
    expect(rowCount()).toBe(50)

    // 12 of the 60 are rides; the rest are runs.
    fireEvent.click(screen.getByRole("button", { name: "Ride" }))
    expect(rowCount()).toBe(12)
  })

  it("keeps the chosen step across a filter change", () => {
    renderScreen(makeActivities(60))
    fireEvent.click(pageSizeChip(10))
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    expect(rowCount()).toBe(10)
    expect(pageSizeChip(10).getAttribute("aria-pressed")).toBe("true")
  })
})

describe("ActivitiesScreen — when there is nothing to choose", () => {
  it("hides the control when the smallest step already shows everything", () => {
    renderScreen(makeActivities(8))
    expect(screen.queryByRole("group", { name: /per page/i })).toBeNull()
    expect(rowCount()).toBe(8)
  })

  it("keeps the control once the whole list fits, so the choice is reversible", () => {
    renderScreen(makeActivities(40))
    fireEvent.click(pageSizeChip(50))
    expect(rowCount()).toBe(40)
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull()
    // Still there — otherwise there would be no way back to a smaller step.
    expect(pageSizeChip(10)).toBeTruthy()
  })
})
