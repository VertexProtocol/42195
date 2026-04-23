#!/usr/bin/env node
/**
 * scripts/seed-test-friend.js
 *
 * Creates a mock "test friend" user in Supabase with a marathon goal and
 * realistic 6-week activity history. Useful for developing / testing the
 * shared-goal social feature before Strava API access to multi-user is
 * approved.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/seed-test-friend.js
 *
 * Optional env vars:
 *   FRIEND_EMAIL        default: "testkompis@example.com"
 *   FRIEND_PASSWORD     default: "TestKompis123!"
 *   FRIEND_DISPLAY_NAME default: "Test Kompis"
 *   MARATHON_DATE       default: "2026-09-20" (Oslo Marathon 2026)
 *
 * The script is idempotent: if the user already exists, it deletes their
 * seeded activities/goals and reseeds, keeping the same user_id.
 */

const SUPABASE_URL              = process.env.SUPABASE_URL              || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

const FRIEND_EMAIL        = process.env.FRIEND_EMAIL        || "testkompis@example.com"
const FRIEND_PASSWORD     = process.env.FRIEND_PASSWORD     || "TestKompis123!"
const FRIEND_DISPLAY_NAME = process.env.FRIEND_DISPLAY_NAME || "Test Kompis"
const MARATHON_DATE       = process.env.MARATHON_DATE       || "2026-09-20"

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const authHeaders = {
  "apikey": SUPABASE_SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
}

// ---- Helpers ----

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { ...authHeaders, ...(opts.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${body}`)
  }
  return res.status === 204 ? null : res.json()
}

function isoDaysAgo(days, hour = 7) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function mondayOfWeekOffset(weekOffset) {
  const d = new Date()
  const day = d.getDay() || 7 // Sunday = 7
  d.setDate(d.getDate() - day + 1 + weekOffset * 7) // Monday of offset week
  d.setHours(0, 0, 0, 0)
  // Return YYYY-MM-DD
  return d.toISOString().slice(0, 10)
}

// ---- Step 1: create or re-use auth user ----

async function findOrCreateUser() {
  // Try to list users with this email. The admin users endpoint supports `email` query.
  const list = await supaFetch(
    `/auth/v1/admin/users?email=${encodeURIComponent(FRIEND_EMAIL)}`,
    { method: "GET" },
  )
  const existing = (list.users ?? []).find((u) => u.email === FRIEND_EMAIL)
  if (existing) {
    console.log(`♻️   Re-using existing user: ${existing.id}`)
    return existing.id
  }

  const created = await supaFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: FRIEND_EMAIL,
      password: FRIEND_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: FRIEND_DISPLAY_NAME },
    }),
  })
  console.log(`✨  Created new user: ${created.id}`)
  return created.id
}

// ---- Step 2: ensure profile has correct display_name ----

async function upsertProfile(userId) {
  await supaFetch("/rest/v1/profiles", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: userId,
      display_name: FRIEND_DISPLAY_NAME,
      email: FRIEND_EMAIL,
    }),
  })
}

// ---- Step 3: wipe previous seeded data so the script is idempotent ----

async function wipeSeeded(userId) {
  for (const table of ["activities", "weekly_goals", "goal_preferences", "goals"]) {
    try {
      await supaFetch(`/rest/v1/${table}?user_id=eq.${userId}`, { method: "DELETE" })
    } catch (err) {
      // Some tables may not exist in dev — skip gracefully
      if (!String(err).includes("42P01")) console.warn(`  skip ${table}: ${err.message}`)
    }
  }
}

// ---- Step 4: create marathon goal + preferences ----

async function createGoal(userId) {
  const [goal] = await supaFetch("/rest/v1/goals", {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      name: "Oslo Maraton 2026",
      goal_category: "event_training",
      target_distance_km: 42.195,
      target_date: MARATHON_DATE,
      current_distance_km: 0,
      is_active: true,
      is_starred: true,
      display_order: 0,
    }),
  })

  try {
    await supaFetch("/rest/v1/goal_preferences", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({
        goal_id: goal.id,
        sessions_per_week: 4,
        focus: "balanced",
        weekly_increase_pct: 10,
        block_weeks: 4,
        regenerate_every_weeks: 4,
      }),
    })
  } catch (err) {
    console.warn(`  (goal_preferences skipped: ${err.message})`)
  }

  return goal
}

// ---- Step 5: create ~6 weeks of realistic activities ----
//
// Pattern per week (Mon, Wed, Fri, Sun): easy 6k, tempo 8k, easy 7k, long 15-22k
// Long run progressively increases 15 → 16 → 18 → 20 → 22 → 20 (deload)

const LONG_RUN_KM = [22, 20, 18, 16, 18, 15] // weeks ago 0..5, so index 0 is current week
const SESSIONS = [
  { dayOffset: 6, type: "easy",  km: 6,  paceMinKm: 5.6, hr: 138, name: "Rolig mandagstur" },
  { dayOffset: 4, type: "tempo", km: 8,  paceMinKm: 4.6, hr: 168, name: "Terskelintervaller" },
  { dayOffset: 2, type: "easy",  km: 7,  paceMinKm: 5.4, hr: 142, name: "Restitusjonsløp" },
  { dayOffset: 0, type: "long",  km: 18, paceMinKm: 5.3, hr: 152, name: "Langtur" },
]

function buildWeekActivities(userId, weeksAgo) {
  // Monday of `weeksAgo` weeks ago
  const weekStart = new Date()
  const today = new Date()
  const day = today.getDay() || 7
  weekStart.setDate(today.getDate() - day + 1 - weeksAgo * 7)

  const activities = []
  for (const s of SESSIONS) {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + s.dayOffset)
    // Skip future dates (e.g. long run on Sunday when today is Wednesday)
    if (date > today) continue

    const km = s.type === "long" ? LONG_RUN_KM[weeksAgo] ?? 18 : s.km
    const jitter = (Math.random() - 0.5) * 0.3 // ±0.15 min/km
    const pace = s.paceMinKm + jitter
    const duration = Math.round(km * pace * 60)
    date.setHours(7 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0)

    activities.push({
      user_id: userId,
      strava_id: null,
      type: "Run",
      name: s.name,
      date: date.toISOString(),
      distance_km: km,
      duration_seconds: duration,
      pace_min_per_km: Number(pace.toFixed(2)),
      elevation_gain_m: s.type === "long" ? 120 + Math.floor(Math.random() * 80) : 30 + Math.floor(Math.random() * 40),
      avg_heart_rate: s.hr + Math.floor(Math.random() * 6 - 3),
      avg_cadence: 170 + Math.floor(Math.random() * 8),
      calories: Math.round(km * 65),
      map_polyline: null,
    })
  }
  return activities
}

async function createActivities(userId) {
  const all = []
  for (let w = 0; w < 6; w++) all.push(...buildWeekActivities(userId, w))
  if (all.length === 0) return
  await supaFetch("/rest/v1/activities", {
    method: "POST",
    body: JSON.stringify(all),
  })
  console.log(`🏃  Inserted ${all.length} activities`)
  return all
}

// ---- Step 6: weekly goals (recurring) ----

async function createWeeklyGoals(userId) {
  const mondayStr = mondayOfWeekOffset(0)
  const weeklyGoals = [
    {
      user_id: userId,
      metric: "distance_km",
      label: "Ukentlig distanse",
      target: 45,
      current: 0,
      week_start: mondayStr,
      is_recurring: true,
      display_order: 0,
    },
    {
      user_id: userId,
      metric: "sessions",
      label: "Løpeøkter",
      target: 4,
      current: 0,
      week_start: mondayStr,
      is_recurring: true,
      display_order: 1,
    },
  ]
  await supaFetch("/rest/v1/weekly_goals", {
    method: "POST",
    body: JSON.stringify(weeklyGoals),
  })
}

// ---- Step 7: update current_distance_km on the goal ----

async function updateGoalProgress(userId, goalId, activities) {
  const totalKm = activities.reduce((s, a) => s + a.distance_km, 0)
  await supaFetch(`/rest/v1/goals?id=eq.${goalId}`, {
    method: "PATCH",
    body: JSON.stringify({ current_distance_km: Number(totalKm.toFixed(2)) }),
  })
}

// ---- Main ----

async function main() {
  console.log(`🌱  Seeding test friend: ${FRIEND_DISPLAY_NAME} <${FRIEND_EMAIL}>`)
  const userId = await findOrCreateUser()
  await upsertProfile(userId)
  await wipeSeeded(userId)
  const goal = await createGoal(userId)
  const activities = await createActivities(userId) ?? []
  await createWeeklyGoals(userId)
  await updateGoalProgress(userId, goal.id, activities)

  console.log("")
  console.log("✅  Done!")
  console.log(`    User ID:       ${userId}`)
  console.log(`    Email:         ${FRIEND_EMAIL}`)
  console.log(`    Password:      ${FRIEND_PASSWORD}`)
  console.log(`    Display name:  ${FRIEND_DISPLAY_NAME}`)
  console.log(`    Goal:          ${goal.name} (${goal.id})`)
  console.log("")
  console.log("Log in with these credentials in another browser profile or incognito window")
  console.log("to test the shared-goal invitation flow end-to-end.")
}

main().catch((err) => {
  console.error("❌  Seed failed:", err)
  process.exit(1)
})
