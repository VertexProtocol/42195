// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { ActivityDetailScreen } from "./activity-detail-screen"
import type { Activity, Lap, StreamPoint } from "@/lib/types"

/**
 * What one run is allowed to put on screen.
 *
 * The screen used to stack four charts, two lists of zone bars and a card per
 * measurement; the readings a run carries are now offered one at a time, so
 * the cases worth pinning are the ones where "one at a time" could quietly
 * become "all of them": the chart selection, the distribution selection, and
 * the picker that used to grow out of the page.
 */

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { map_polyline: null } }) }),
      }),
    }),
  }),
}))

const ACTIVITY: Activity = {
  id: "activity-1",
  user_id: "user-1",
  strava_id: 9001,
  type: "Run",
  name: "Tuesday intervals",
  date: "2026-03-10",
  distance_km: 10,
  duration_seconds: 3000,
  pace_min_per_km: 5,
  elevation_gain_m: 120,
  avg_heart_rate: 154,
  avg_cadence: 86,
  calories: 640,
  created_at: "2026-03-10",
}

/** A stream carrying every reading, so all four chips are on offer. */
function makeStreams(): StreamPoint[] {
  return Array.from({ length: 40 }, (_, i) => ({
    time: i * 30,
    hr: 130 + (i % 12) * 4,
    pace: 5 + (i % 6) * 0.1,
    altitude: 100 + (i % 8),
    cadence: 84 + (i % 4),
  }))
}

const LAPS: Lap[] = [
  { index: 1, distance_km: 1, duration_seconds: 320, pace_min_per_km: 5.33, avg_heart_rate: 148 },
  { index: 2, distance_km: 1, duration_seconds: 280, pace_min_per_km: 4.67, avg_heart_rate: 162 },
  { index: 3, distance_km: 1, duration_seconds: 300, pace_min_per_km: 5, avg_heart_rate: 155 },
]

interface Responses {
  streams?: StreamPoint[]
  laps?: Lap[]
  analysis?: string | null
  testRuns?: unknown[]
}

function mockFetch({ streams = makeStreams(), laps = LAPS, analysis = null, testRuns = [] }: Responses = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown) =>
      ({ ok: true, json: async () => body }) as unknown as Response
    if (url.includes("/streams")) return json({ points: streams })
    if (url.includes("/laps")) return json({ laps })
    if (url.includes("activity-analysis")) return json({ analysis })
    if (url.includes("test-runs")) return json({ test_runs: testRuns })
    return json({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderScreen(props: Partial<Parameters<typeof ActivityDetailScreen>[0]> = {}) {
  return render(
    <I18nProvider>
      <ActivityDetailScreen
        activity={ACTIVITY}
        onBack={() => {}}
        onDelete={async () => true}
        allActivities={[ACTIVITY]}
        {...props}
      />
    </I18nProvider>,
  )
}

/** The chips offering one reading of the run at a time. */
function metricChips(): HTMLElement[] {
  return within(
    screen.getByRole("group", { name: /choose a measurement/i }),
  ).getAllByRole("button")
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ActivityDetailScreen — the trace", () => {
  it("offers every reading the run carries, and draws one of them", async () => {
    mockFetch()
    renderScreen()

    await waitFor(() => expect(metricChips().length).toBe(4))

    const labels = metricChips().map((chip) => chip.textContent)
    expect(labels).toEqual(["Pace", "Heart rate", "Elevation", "Cadence"])
    // One selected, and only one — the point of the redesign.
    expect(
      metricChips().filter((chip) => chip.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(1)
    expect(metricChips()[0].getAttribute("aria-pressed")).toBe("true")
  })

  it("moves the selection to the chip that was pressed", async () => {
    mockFetch()
    renderScreen()

    await waitFor(() => expect(metricChips().length).toBe(4))
    fireEvent.click(metricChips()[1])

    expect(metricChips()[0].getAttribute("aria-pressed")).toBe("false")
    expect(metricChips()[1].getAttribute("aria-pressed")).toBe("true")
  })

  it("offers no chips at all when the run carries one reading", async () => {
    mockFetch({
      streams: makeStreams().map((point) => ({
        ...point,
        hr: null,
        altitude: null,
        cadence: null,
      })),
    })
    renderScreen()

    await waitFor(() => expect(screen.getByText("During the run")).toBeDefined())
    // A row of one chip is a control that cannot be used.
    expect(screen.queryByRole("group", { name: /choose a measurement/i })).toBeNull()
  })

  it("says nothing about a run with no detail behind it", async () => {
    mockFetch({ streams: [], laps: [] })
    renderScreen()

    await waitFor(() => expect(screen.getByText("Tuesday intervals")).toBeDefined())
    expect(screen.queryByText("During the run")).toBeNull()
    expect(screen.queryByText("Laps")).toBeNull()
    expect(screen.queryByText("Time in zones")).toBeNull()
  })
})

describe("ActivityDetailScreen — the numbers", () => {
  it("keeps the watch's other readings with the headline ones", async () => {
    mockFetch()
    renderScreen()

    // No section of their own: elevation, heart rate, cadence and calories are
    // the small print of the three numbers above them.
    expect(screen.getByText("Elevation gain")).toBeDefined()
    expect(screen.getByText("120")).toBeDefined()
    expect(screen.getByText("Calories")).toBeDefined()
    await waitFor(() => expect(screen.getByText("Avg cadence")).toBeDefined())
  })

  it("counts both feet in a runner's cadence", async () => {
    mockFetch()
    renderScreen()

    // Strava reports 86 rpm for one leg; a runner runs at 172 spm.
    await waitFor(() => expect(screen.getByText("172")).toBeDefined())
    expect(screen.getByText("spm")).toBeDefined()
  })
})

describe("ActivityDetailScreen — splits and zones", () => {
  it("lists every lap", async () => {
    mockFetch()
    renderScreen()

    await waitFor(() => expect(screen.getByText("Laps")).toBeDefined())
    expect(screen.getByText("4:40 /km")).toBeDefined()
    expect(screen.getByText("5:20 /km")).toBeDefined()
  })

  it("draws one distribution at a time and swaps it on request", async () => {
    mockFetch()
    renderScreen()

    await waitFor(() => expect(screen.getByText("Time in zones")).toBeDefined())

    const zoneGroup = screen.getByRole("group", { name: /choose a distribution/i })
    const zoneChips = within(zoneGroup).getAllByRole("button")
    expect(zoneChips.map((chip) => chip.textContent)).toEqual(["Heart rate", "Pace"])

    // Heart-rate zones lead, and they are named rather than left as colours.
    expect(screen.getByRole("img", { name: /time in zones — heart rate/i })).toBeDefined()

    fireEvent.click(zoneChips[1])
    expect(screen.getByRole("img", { name: /time in zones — pace/i })).toBeDefined()
  })
})

describe("ActivityDetailScreen — admin", () => {
  it("picks a test run type in the app's own sheet, not in the page", async () => {
    const fetchMock = mockFetch()
    renderScreen()

    const open = await screen.findByRole("button", { name: /mark as test run/i })
    // Nothing is offered until it is asked for.
    expect(screen.queryByText("5 km time trial")).toBeNull()

    fireEvent.click(open)

    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /5 km time trial/i }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => typeof init?.body === "string" && init.body.includes("5k_time_trial"),
        ),
      ).toBe(true),
    )
  })

  it("confirms a delete where the delete button is", async () => {
    mockFetch()
    const onDelete = vi.fn(async () => true)
    renderScreen({ onDelete })

    fireEvent.click(screen.getByRole("button", { name: /delete activity/i }))
    expect(screen.getByText(/are you sure/i)).toBeDefined()

    const confirm = screen
      .getAllByRole("button", { name: /delete activity/i })
      .at(-1) as HTMLElement
    fireEvent.click(confirm)

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("activity-1"))
  })
})
