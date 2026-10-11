import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  createStarterPlan,
  feedbackSchema,
  nextStarterWeek,
  recordStarterFeedback,
  starterProfileSchema,
  starterStateSchema,
} from "@/lib/starter-plan";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setup"),
    version: z.number().int().min(0),
    profile: starterProfileSchema,
  }),
  z.object({
    action: z.literal("feedback"),
    version: z.number().int().positive(),
    sessionId: z.string().max(40),
    feedback: feedbackSchema,
  }),
  z.object({ action: z.literal("next"), version: z.number().int().positive() }),
]);
export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await db
    .from("starter_plans")
    .select("state, version")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  return NextResponse.json({ plan: data ?? null, userId: user.id });
}
export async function POST(req: NextRequest) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_answers" }, { status: 400 });
  const body = parsed.data;
  const { data: row, error } = await db
    .from("starter_plans")
    .select("state, version")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  if ((row?.version ?? 0) !== body.version)
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  try {
    const previous = row ? starterStateSchema.parse(row.state) : null;
    let state;
    if (body.action === "setup") {
      state = createStarterPlan(body.profile);
      if (previous)
        state.history = [...previous.history, previous.week].slice(-12);
    } else {
      if (!previous)
        return NextResponse.json({ error: "setup_required" }, { status: 400 });
      state =
        body.action === "feedback"
          ? recordStarterFeedback(previous, body.sessionId, body.feedback)
          : nextStarterWeek(previous);
    }
    const value = {
      state,
      version: body.version + 1,
      updated_at: new Date().toISOString(),
    };
    const query = row
      ? db
          .from("starter_plans")
          .update(value)
          .eq("user_id", user.id)
          .eq("version", body.version)
      : db.from("starter_plans").insert({ ...value, user_id: user.id });
    const { data: saved, error: saveError } = await query
      .select("state, version")
      .maybeSingle();
    if (saveError)
      return NextResponse.json(
        { error: saveError.code === "23505" ? "conflict" : "save_failed" },
        { status: saveError.code === "23505" ? 409 : 503 },
      );
    if (!saved)
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    return NextResponse.json({ plan: saved });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_answers";
    const known = [
      "unknown_session",
      "week_not_finished",
      "feedback_required",
      "pain_review",
    ];
    return NextResponse.json(
      { error: known.includes(code) ? code : "invalid_answers" },
      { status: 400 },
    );
  }
}
