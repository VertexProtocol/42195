#!/usr/bin/env node
/**
 * scripts/bootstrap-strava.js
 *
 * Run once to seed strava_tokens for your user without going through the
 * full OAuth redirect flow.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   SUPABASE_USER_ID=<your-auth.users uuid> \
 *   node scripts/bootstrap-strava.js
 *
 * Or just fill in the constants below and run: node scripts/bootstrap-strava.js
 */

// ── Fill these in (or pass as env vars) ──────────────────────────────────────
const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID     || "204882"
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "897014af45c4a1d939c0bc83eb64aa0783c6c1e0"
const STRAVA_REFRESH_TOKEN = process.env.STRAVA_BOOTSTRAP_REFRESH_TOKEN || "b1dce5f94a1153b20a13d886c8e952030afb7c86"

const SUPABASE_URL              = process.env.SUPABASE_URL              || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const SUPABASE_USER_ID          = process.env.SUPABASE_USER_ID          || "" // uuid from auth.users

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
    console.error(
      "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID"
    )
    process.exit(1)
  }

  // 1. Exchange refresh token → fresh access + refresh tokens
  console.log("🔄  Refreshing Strava token...")
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: STRAVA_REFRESH_TOKEN,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error(`❌  Token refresh failed (${tokenRes.status}):`, body)
    process.exit(1)
  }

  const tokens = await tokenRes.json()
  const { access_token, refresh_token, expires_at } = tokens
  console.log(`✅  Access token obtained, expires at: ${new Date(expires_at * 1000).toISOString()}`)

  // 2. Fetch Strava athlete to get athlete_id
  console.log("👤  Fetching Strava athlete profile...")
  const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  if (!athleteRes.ok) {
    const body = await athleteRes.text()
    console.error(`❌  Athlete fetch failed (${athleteRes.status}):`, body)
    process.exit(1)
  }

  const athlete = await athleteRes.json()
  console.log(`✅  Athlete: ${athlete.firstname} ${athlete.lastname} (ID: ${athlete.id})`)

  // 3. Upsert into strava_tokens via Supabase REST
  console.log("💾  Seeding strava_tokens...")
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/strava_tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: SUPABASE_USER_ID,
      athlete_id: athlete.id,
      access_token,
      refresh_token,
      expires_at: new Date(expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  })

  if (!upsertRes.ok) {
    const body = await upsertRes.text()
    console.error(`❌  Supabase upsert failed (${upsertRes.status}):`, body)
    process.exit(1)
  }

  console.log("")
  console.log("🎉  Done! Strava tokens seeded successfully.")
  console.log(`    User ID:    ${SUPABASE_USER_ID}`)
  console.log(`    Athlete:    ${athlete.firstname} ${athlete.lastname} (${athlete.id})`)
  console.log(`    Expires at: ${new Date(expires_at * 1000).toISOString()}`)
  console.log("")
  console.log("You can now remove STRAVA_BOOTSTRAP_* from your environment variables.")
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
