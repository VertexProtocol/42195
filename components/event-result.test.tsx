// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { EventResult } from "./event-result"
import { I18nProvider } from "@/lib/i18n"
import type { Activity, Goal } from "@/lib/types"
const goal = { id: "g", goal_category: "event_training", target_date: "2026-09-20", target_distance_km: 42.195, target_time_seconds: 14400 } as Goal
const run = { id: "a", strava_id: 123, type: "Run", name: "Marathon", date: "2026-09-20T08:00:00Z", local_date: "2026-09-20", distance_km: 42.3, duration_seconds: 13800, elapsed_seconds: 14500 } as Activity
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function mount(g = goal, a = run, onChange = vi.fn()) {
  render(<I18nProvider><EventResult goal={g} activities={[a]} onChange={onChange} /></I18nProvider>)
  return onChange
}
describe("race correction", () => {
  it("links evidence and persists a rejected automatic match", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "g", event_match_dismissed: true }) })
    vi.stubGlobal("fetch", fetch)
    const onChange = mount()
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://www.strava.com/activities/123")
    fireEvent.click(screen.getByRole("button", { name: /wasn't the race/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: "g", event_match_dismissed: true }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "dismiss" })
  })
  it("confirms an uncertain legacy upload", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "g", event_activity_id: "a" }) })
    vi.stubGlobal("fetch", fetch)
    mount(goal, { ...run, local_date: null })
    fireEvent.click(screen.getByRole("button", { name: "Yes" }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "confirm", activityId: "a" })
  })
  it("keeps the previous result on failed save and allows retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const onChange = mount()
    fireEvent.click(screen.getByRole("button", { name: /wasn't the race/i }))
    await screen.findByRole("alert")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /wasn't the race/i }).hasAttribute("disabled")).toBe(false)
  })
})
