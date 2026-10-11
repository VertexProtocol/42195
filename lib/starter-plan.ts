import { z } from "zod";

export const starterProfileSchema = z
  .object({
    mode: z.enum(["beginner", "experienced", "returning"]),
    aim: z.enum(["start", "habit", "race"]),
    days: z.number().int().min(1).max(5),
    continuousMinutes: z.number().int().min(0).max(180),
    weeklyMinutes: z.number().int().min(0).max(1200),
    pauseWeeks: z.number().int().min(0).max(104),
    hasPain: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.mode !== "beginner" && p.weeklyMinutes < 10)
      ctx.addIssue({
        code: "custom",
        path: ["weeklyMinutes"],
        message: "Enter your usual weekly running time.",
      });
    if (p.mode === "returning" && p.pauseWeeks < 1)
      ctx.addIssue({
        code: "custom",
        path: ["pauseWeeks"],
        message: "Enter the length of your break.",
      });
  });
export type StarterProfile = z.infer<typeof starterProfileSchema>;
export const feedbackSchema = z.enum(["easy", "ok", "hard", "time", "pain"]);
export type StarterFeedback = z.infer<typeof feedbackSchema>;
const sessionSchema = z.object({
  id: z.string(),
  dayOffset: z.number().int().min(0).max(6),
  minutes: z.number().min(0).max(60),
  runSeconds: z.number().int().min(0),
  walkSeconds: z.number().int().min(0),
  repeats: z.number().int().min(0),
  feedback: feedbackSchema.nullable(),
});
const weekSchema = z.object({
  number: z.number().int().positive(),
  startsAt: z.string().datetime(),
  reason: z.enum(["initial", "repeat", "easier", "progress", "review"]),
  sessions: z.array(sessionSchema).max(5),
});
export const starterStateSchema = z.object({
  source: z.literal("self_reported"),
  profile: starterProfileSchema,
  week: weekSchema,
  history: z.array(weekSchema).max(12),
});
export type StarterState = z.infer<typeof starterStateSchema>;

function makeWeek(
  profile: StarterProfile,
  number: number,
  minutes: number,
  reason: StarterState["week"]["reason"],
  now: Date,
): StarterState["week"] {
  const runWalk =
    profile.mode === "beginner" ||
    profile.continuousMinutes < 10 ||
    (profile.mode === "returning" && profile.pauseWeeks >= 4);
  const count = Math.min(
    profile.days,
    runWalk
      ? 3
      : Math.max(1, Math.min(5, Math.floor(profile.weeklyMinutes / 10))),
  );
  const repeats = runWalk ? Math.max(1, Math.floor((minutes - 10) / 2.5)) : 0;
  const duration = runWalk
    ? 10 + repeats * 2.5
    : Math.max(10, Math.round(minutes));
  return {
    number,
    startsAt: now.toISOString(),
    reason,
    sessions: profile.hasPain
      ? []
      : Array.from({ length: count }, (_, i) => ({
          id: `${number}-${i}`,
          dayOffset: Math.floor((i * 7) / count),
          minutes: duration,
          runSeconds: runWalk ? 60 : 0,
          walkSeconds: runWalk ? 90 : 0,
          repeats,
          feedback: null,
        })),
  };
}
export function createStarterPlan(
  profile: StarterProfile,
  now = new Date(),
): StarterState {
  const p = starterProfileSchema.parse(profile);
  const factor =
    p.mode !== "returning"
      ? 1
      : p.pauseWeeks <= 1
        ? 0.8
        : p.pauseWeeks <= 2
          ? 0.65
          : p.pauseWeeks <= 4
            ? 0.4
            : 0.35;
  const minutes =
    p.mode === "beginner"
      ? 20
      : Math.min(
          40,
          Math.max(10, (p.weeklyMinutes / Math.min(p.days, 5)) * factor),
          Math.max(10, p.continuousMinutes + 10),
        );
  return {
    source: "self_reported",
    profile: p,
    week: makeWeek(p, 1, minutes, p.hasPain ? "review" : "initial", now),
    history: [],
  };
}
export function recordStarterFeedback(
  state: StarterState,
  id: string,
  feedback: StarterFeedback,
): StarterState {
  if (!state.week.sessions.some((s) => s.id === id))
    throw new Error("unknown_session");
  const sessions = state.week.sessions.map((s) =>
    s.id === id ? { ...s, feedback } : s,
  );
  const reason = sessions.some((s) => s.feedback === "pain")
    ? "review"
    : state.week.reason === "review"
      ? "repeat"
      : state.week.reason;
  return { ...state, week: { ...state.week, reason, sessions } };
}
export function nextStarterWeek(
  state: StarterState,
  now = new Date(),
): StarterState {
  if (+now < +new Date(state.week.startsAt) + 7 * 86400000)
    throw new Error("week_not_finished");
  if (
    !state.week.sessions.length ||
    state.week.sessions.some((s) => !s.feedback)
  )
    throw new Error("feedback_required");
  const feedback = state.week.sessions.map((s) => s.feedback);
  if (feedback.includes("pain")) throw new Error("pain_review");
  const hard = feedback.includes("hard");
  const allEasy = feedback.every((f) => f === "easy");
  const previous = state.week.sessions[0].minutes;
  // Time pressure never implies reduced capacity; one easy week alone does not trigger a progression.
  const previousEasy =
    state.history.at(-1)?.sessions.every((s) => s.feedback === "easy") === true;
  const progress = allEasy && previousEasy;
  const minimum = state.week.sessions[0].repeats > 0 ? 12.5 : 10;
  const minutes = hard
    ? Math.max(minimum, previous * 0.85)
    : progress
      ? Math.min(40, previous + 2.5)
      : previous;
  const reason = hard ? "easier" : progress ? "progress" : "repeat";
  return {
    ...state,
    week: makeWeek(state.profile, state.week.number + 1, minutes, reason, now),
    history: [...state.history, state.week].slice(-12),
  };
}
