import { describe, it, expect } from "vitest";
import {
  createStarterPlan,
  nextStarterWeek,
  recordStarterFeedback,
  starterProfileSchema,
  type StarterProfile,
} from "./starter-plan";
const now = new Date("2026-10-11T12:00:00Z");
const p: StarterProfile = {
  mode: "beginner",
  aim: "start",
  days: 2,
  continuousMinutes: 0,
  weeklyMinutes: 0,
  pauseWeeks: 0,
  hasPain: false,
};
const later = (n: number) => new Date(+now + n * 86400000);
function answered(value: "easy" | "ok" | "hard" | "time" | "pain") {
  let state = createStarterPlan(p, now);
  for (const s of state.week.sessions)
    state = recordStarterFeedback(state, s.id, value);
  return state;
}
describe("starter plan", () => {
  it("gives a new runner a time-based plan without inventing distance or pace", () => {
    const s = createStarterPlan(p, now);
    expect(s.source).toBe("self_reported");
    expect(s.week.sessions).toHaveLength(2);
    expect(s.week.sessions[0].minutes).toBe(20);
    expect(s.week.sessions[0].repeats).toBe(4);
    expect(s.week.sessions[1].dayOffset).toBe(3);
    expect(JSON.stringify(s)).not.toContain("pace");
  });
  it("uses reported training and reduces a comeback", () => {
    const p2 = {
      ...p,
      mode: "experienced" as const,
      weeklyMinutes: 120,
      continuousMinutes: 40,
      days: 3,
    };
    expect(createStarterPlan(p2, now).week.sessions[0].minutes).toBe(40);
    expect(
      createStarterPlan({ ...p2, mode: "returning", pauseWeeks: 6 }, now).week
        .sessions[0].minutes,
    ).toBeLessThan(40);
  });
  it("limits beginner frequency and keeps rest days", () => {
    expect(
      createStarterPlan({ ...p, days: 5 }, now).week.sessions.map(
        (s) => s.dayOffset,
      ),
    ).toEqual([0, 2, 4]);
  });
  it("keeps discomfort separate from simple lack of experience", () => {
    const s = createStarterPlan({ ...p, hasPain: true }, now);
    expect(s.week.reason).toBe("review");
    expect(s.week.sessions).toHaveLength(0);
  });
  it("requires valid non-beginner history", () => {
    expect(
      starterProfileSchema.safeParse({ ...p, mode: "experienced" }).success,
    ).toBe(false);
    expect(starterProfileSchema.safeParse({ ...p, days: 99 }).success).toBe(
      false,
    );
  });
  it("does not increase after a single easy week", () => {
    expect(
      nextStarterWeek(answered("easy"), later(7)).week.sessions[0].minutes,
    ).toBe(20);
  });
  it("increases only after two easy weeks and preserves feedback history", () => {
    let s = nextStarterWeek(answered("easy"), later(7));
    for (const session of s.week.sessions)
      s = recordStarterFeedback(s, session.id, "easy");
    s = nextStarterWeek(s, later(14));
    expect(s.week.sessions[0].minutes).toBe(22.5);
    expect(s.history).toHaveLength(2);
  });
  it("does not interpret time pressure as reduced capacity", () => {
    expect(
      nextStarterWeek(answered("time"), later(7)).week.sessions[0].minutes,
    ).toBe(20);
  });
  it("reduces a difficult week", () => {
    expect(
      nextStarterWeek(answered("hard"), later(7)).week.sessions[0].minutes,
    ).toBeLessThan(20);
  });
  it("does not advance early, on missing feedback or after pain", () => {
    expect(() => nextStarterWeek(answered("easy"), later(1))).toThrow(
      "week_not_finished",
    );
    expect(() => nextStarterWeek(createStarterPlan(p, now), later(7))).toThrow(
      "feedback_required",
    );
    expect(() => nextStarterWeek(answered("pain"), later(7))).toThrow(
      "pain_review",
    );
  });
  it("does not increase a short session after hard feedback", () => {
    let state = createStarterPlan(
      {
        ...p,
        mode: "experienced",
        weeklyMinutes: 10,
        continuousMinutes: 10,
        days: 1,
      },
      now,
    );
    state = recordStarterFeedback(state, "1-0", "hard");
    expect(
      nextStarterWeek(state, later(7)).week.sessions[0].minutes,
    ).toBeLessThanOrEqual(state.week.sessions[0].minutes);
  });
  it("keeps rest days for run-walk comeback weeks too", () => {
    expect(
      createStarterPlan(
        {
          ...p,
          mode: "returning",
          weeklyMinutes: 120,
          continuousMinutes: 20,
          pauseWeeks: 8,
          days: 5,
        },
        now,
      ).week.sessions.map((s) => s.dayOffset),
    ).toEqual([0, 2, 4]);
  });
  it("rejects unknown sessions without modifying the original plan", () => {
    const s = createStarterPlan(p, now);
    expect(() => recordStarterFeedback(s, "wrong", "easy")).toThrow();
    expect(s.week.sessions[0].feedback).toBeNull();
  });
});


it("uses current ability even when the runner calls themselves a beginner", () => {
  const result = createStarterPlan({ ...p, continuousMinutes: 20 });
  expect(result.week.sessions).toHaveLength(2);
  expect(result.week.sessions[0]).toMatchObject({ minutes: 20, repeats: 0 });
});
it("does not compound unknown volume, capacity and break into a tiny session", () => {
  const result = createStarterPlan({ ...p, mode: "returning", weeklyMinutes: 30, pauseWeeks: 12, estimatedFields: ["weeklyMinutes", "continuousMinutes", "pauseWeeks"] });
  expect(result.week.sessions[0]).toMatchObject({ minutes: 20, repeats: 4 });
});
it("does not let an estimated weekly volume override known current ability", () => {
  const result = createStarterPlan({ ...p, mode: "experienced", weeklyMinutes: 30, continuousMinutes: 30, estimatedFields: ["weeklyMinutes"] });
  expect(result.week.sessions[0]).toMatchObject({ minutes: 30, repeats: 0 });
});
