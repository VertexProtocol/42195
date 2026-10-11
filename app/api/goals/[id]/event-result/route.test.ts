import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const mocks = vi.hoisted(() => ({ client: { auth: { getUser: vi.fn() }, from: vi.fn() }, activities: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }))
vi.mock("@/lib/activities-query", () => ({ fetchAllActivities: mocks.activities }))
vi.mock("@/lib/shared-goal-sync", () => ({ refreshSharedGoalPositions: mocks.refresh }))
import { POST } from "./route"
const goal = { id: "g", goal_category: "event_training", target_date: "2026-09-20", target_distance_km: 42.195, target_time_seconds: null }
const activityId = "00000000-0000-4000-8000-000000000001"
let chain: any
function post(body: unknown) { return POST(new NextRequest("http://localhost/api/goals/g/event-result", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "g" }) }) }
beforeEach(() => {
 vi.clearAllMocks()
 chain = {}
 for (const key of ["select", "eq", "update"]) chain[key] = vi.fn(() => chain)
 chain.maybeSingle = vi.fn().mockResolvedValue({ data: goal })
 chain.single = vi.fn().mockResolvedValue({ data: { id: "g", event_activity_id: activityId, event_match_dismissed: false } })
 mocks.client.from.mockReturnValue(chain)
 mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "owner" } } })
 mocks.activities.mockResolvedValue([])
})
describe("event result ownership", () => {
 it("rejects signed-out writes without reading rows", async () => {
   mocks.client.auth.getUser.mockResolvedValue({ data: { user: null } })
   expect((await post({ action: "dismiss" })).status).toBe(401)
   expect(mocks.client.from).not.toHaveBeenCalled()
 })
 it("does not update an inaccessible goal", async () => {
   chain.maybeSingle.mockResolvedValue({ data: null })
   expect((await post({ action: "dismiss" })).status).toBe(404)
   expect(chain.update).not.toHaveBeenCalled()
 })
 it("rejects unrelated or inaccessible activity IDs", async () => {
   expect((await post({ action: "confirm", activityId })).status).toBe(400)
   expect(chain.update).not.toHaveBeenCalled()
 })
 it("persists a qualifying own activity and refreshes group outcome", async () => {
   mocks.activities.mockResolvedValue([{ id: activityId, strava_id: 1, type: "Run", date: "2026-09-20T09:00:00Z", distance_km: 42.2, duration_seconds: 14000 }])
   expect((await post({ action: "confirm", activityId, user_id: "other" })).status).toBe(200)
   expect(chain.eq).toHaveBeenCalledWith("user_id", "owner")
   expect(chain.update).toHaveBeenCalledWith({ event_activity_id: activityId, event_match_dismissed: false })
   expect(mocks.refresh).toHaveBeenCalledWith("owner")
 })
 it("reports storage failures without claiming a correction succeeded", async () => {
   chain.single.mockResolvedValue({ error: { message: "unavailable" } })
   expect((await post({ action: "dismiss" })).status).toBe(503)
   expect(mocks.refresh).not.toHaveBeenCalled()
 })
})
