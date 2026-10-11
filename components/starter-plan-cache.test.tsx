// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { StarterPlanProvider } from "./starter-plan-cache"
import { StarterPlanEntry } from "./starter-plan-entry"
import { I18nProvider } from "@/lib/i18n"
import { createStarterPlan } from "@/lib/starter-plan"
const state = createStarterPlan({ mode: "beginner", aim: "start", days: 2, continuousMinutes: 0, weeklyMinutes: 0, pauseWeeks: 0, hasPain: false })
function Shell() {
  const [screenName, setScreenName] = useState<"entry" | "goal" | "page">("entry")
  const [account, setAccount] = useState("first")
  return <I18nProvider><button onClick={() => setScreenName("entry")}>Today</button><button onClick={() => setScreenName("goal")}>Goals</button><button onClick={() => setScreenName("page")}>Plan</button><button onClick={() => setAccount("second")}>Switch account</button><StarterPlanProvider key={account}><StarterPlanEntry key={screenName} presentation={screenName} /></StarterPlanProvider></I18nProvider>
}
afterEach(() => vi.unstubAllGlobals())
describe("starter plan across navigation", () => {
  it("shows the cached plan immediately on both Today and Goals while refresh is pending", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ plan: { state, version: 1 }, userId: "first" }) }).mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal("fetch", fetch)
    render(<Shell />)
    await screen.findByRole("button", { name: /Next session/ })
    fireEvent.click(screen.getByRole("button", { name: "Goals" }))
    expect(screen.getByRole("button", { name: /Start running/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Today" }))
    expect(screen.getByRole("button", { name: /Next session/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }))
    expect(screen.queryByRole("button", { name: /Next session/ })).toBeNull()
  })
  it("keeps newly saved feedback when an older background read finishes", async () => {
    let resolveRead: (value: unknown) => void = () => {}
    let gets = 0
    const updated = { ...state, week: { ...state.week, sessions: state.week.sessions.map((s, i) => i === 0 ? { ...s, feedback: "ok" as const } : s) } }
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      if (options?.method === "POST") return { ok: true, json: async () => ({ plan: { state: updated, version: 2 } }) }
      gets++
      if (gets === 1) return { ok: true, json: async () => ({ plan: { state, version: 1 }, userId: "first" }) }
      return new Promise(resolve => { resolveRead = resolve })
    }))
    render(<Shell />)
    await screen.findByRole("button", { name: /Next session/ })
    fireEvent.click(screen.getByRole("button", { name: "Plan" }))
    fireEvent.click(screen.getByRole("button", { name: /Session 1 ·/ }))
    fireEvent.click(screen.getAllByRole("button", { name: "Manageable" })[0])
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Manageable" })[0].getAttribute("aria-pressed")).toBe("true"))
    await act(async () => resolveRead({ ok: true, json: async () => ({ plan: { state, version: 1 }, userId: "first" }) }))
    expect(screen.getAllByRole("button", { name: "Manageable" })[0].getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(screen.getByRole("button", { name: "Goals" }))
    fireEvent.click(screen.getByRole("button", { name: "Plan" }))
    fireEvent.click(screen.getByRole("button", { name: /Session 1 ·/ }))
    expect(screen.getAllByRole("button", { name: "Manageable" })[0].getAttribute("aria-pressed")).toBe("true")
  })
})
