import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  client: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mocks.client,
}));
import { GET, POST } from "./route";
import { createStarterPlan } from "@/lib/starter-plan";
const profile = {
  mode: "beginner" as const,
  aim: "habit" as const,
  days: 2,
  continuousMinutes: 0,
  weeklyMinutes: 0,
  pauseWeeks: 0,
  hasPain: false,
};
function request(body: unknown) {
  return new NextRequest("http://localhost/api/starter-plan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
let chain: any;
beforeEach(() => {
  vi.clearAllMocks();
  chain = {};
  for (const key of ["select", "eq", "insert", "update"])
    chain[key] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn();
  mocks.client.from.mockReturnValue(chain);
  mocks.client.auth.getUser.mockResolvedValue({
    data: { user: { id: "owner" } },
  });
});
describe("starter-plan ownership and persistence", () => {
  it("rejects signed-out reads and writes before accessing rows", async () => {
    mocks.client.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect(
      (await POST(request({ action: "setup", version: 0, profile }))).status,
    ).toBe(401);
    expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it("creates a plan for the authenticated user, ignoring a supplied owner", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { state: createStarterPlan(profile), version: 1 },
        error: null,
      });
    expect(
      (
        await POST(
          request({
            action: "setup",
            version: 0,
            profile,
            user_id: "attacker",
          }),
        )
      ).status,
    ).toBe(200);
    expect(chain.insert.mock.calls[0][0].user_id).toBe("owner");
  });
  it("rejects stale versions without overwriting feedback", async () => {
    chain.maybeSingle.mockResolvedValue({
      data: { state: createStarterPlan(profile), version: 3 },
      error: null,
    });
    expect((await POST(request({ action: "next", version: 2 }))).status).toBe(
      409,
    );
    expect(chain.update).not.toHaveBeenCalled();
  });
  it("uses a version guard when updating feedback", async () => {
    const state = createStarterPlan(profile);
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { state, version: 2 }, error: null })
      .mockResolvedValueOnce({ data: { state, version: 3 }, error: null });
    expect(
      (
        await POST(
          request({
            action: "feedback",
            version: 2,
            sessionId: "1-0",
            feedback: "time",
          }),
        )
      ).status,
    ).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(chain.eq).toHaveBeenCalledWith("version", 2);
    expect(chain.update.mock.calls[0][0].state.week.sessions[0].feedback).toBe(
      "time",
    );
  });
  it("does not claim success when storage fails", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "failure" } });
    expect(
      (await POST(request({ action: "setup", version: 0, profile }))).status,
    ).toBe(503);
  });
  it("validates answers before writing", async () => {
    expect(
      (
        await POST(
          request({
            action: "setup",
            version: 0,
            profile: { ...profile, days: 100 },
          }),
        )
      ).status,
    ).toBe(400);
    expect(chain.insert).not.toHaveBeenCalled();
  });
});
