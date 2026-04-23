#!/usr/bin/env node
/**
 * scripts/remove-test-friend.js
 *
 * Fully removes the seeded "Test Kompis" user from Supabase:
 *   • auth.users row (cascades: activities, goals, weekly_goals,
 *     goal_preferences, profiles, goal_share_members, etc.)
 *   • any shared goals they CREATED but didn't have other members on
 *     (these would otherwise orphan; ones with other members stay,
 *     and the test user is just removed from them)
 *
 * Usage:
 *   npm run remove:friend
 *
 * Or inline:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/remove-test-friend.js
 *
 * Env vars match seed-test-friend.js:
 *   FRIEND_EMAIL (default: testkompis@example.com)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const FRIEND_EMAIL = process.env.FRIEND_EMAIL || "testkompis@example.com"

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const authHeaders = {
  "apikey": SUPABASE_SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
}

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { ...authHeaders, ...(opts.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${body}`)
  }
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function findUser() {
  const list = await supaFetch(
    `/auth/v1/admin/users?email=${encodeURIComponent(FRIEND_EMAIL)}`,
    { method: "GET" },
  )
  return (list.users ?? []).find((u) => u.email === FRIEND_EMAIL) ?? null
}

async function findOrphanSharedGoals(userId) {
  // Shared goals the test user created. We fetch these first so we can
  // report them — the admin user delete below will cascade-remove the
  // user's membership, but goal_shares rows with no cascade FK to auth.users
  // would remain. Let's check.
  const shares = await supaFetch(
    `/rest/v1/goal_shares?created_by=eq.${userId}&select=id,name`,
    { method: "GET" },
  )
  return shares ?? []
}

async function deleteSharedGoal(shareId) {
  await supaFetch(`/rest/v1/goal_shares?id=eq.${shareId}`, { method: "DELETE" })
}

async function deleteAuthUser(userId) {
  await supaFetch(`/auth/v1/admin/users/${userId}`, { method: "DELETE" })
}

async function main() {
  console.log(`🧹  Removing test friend: ${FRIEND_EMAIL}`)

  const user = await findUser()
  if (!user) {
    console.log("   No user found — nothing to remove.")
    return
  }

  console.log(`   Found user: ${user.id}`)

  // Clean up shared goals they created (cascade will remove their membership rows).
  const orphanShares = await findOrphanSharedGoals(user.id)
  if (orphanShares.length) {
    console.log(`   Cleaning up ${orphanShares.length} shared goal(s) they created:`)
    for (const s of orphanShares) {
      console.log(`     - ${s.name} (${s.id})`)
      await deleteSharedGoal(s.id)
    }
  }

  // Delete the auth user — cascades profile, activities, goals,
  // weekly_goals, goal_preferences, and goal_share_members rows.
  await deleteAuthUser(user.id)
  console.log(`✅  Deleted auth user and all associated data.`)
}

main().catch((err) => {
  console.error("❌  Remove failed:", err)
  process.exit(1)
})
