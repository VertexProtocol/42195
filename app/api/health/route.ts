import { NextResponse } from "next/server"

/**
 * Liveness. Deliberately the one route under app/api that does not call
 * supabase.auth.getUser() — a health check has no session to present, and an
 * endpoint that answers 401 to everyone cannot tell you whether the app is up.
 *
 * Serving this dynamically is the point: a cached 200 would keep reporting
 * health from the edge long after the server behind it stopped being able to
 * produce one.
 *
 * proxy.ts excludes /api from the middleware matcher, so this is reachable
 * without being redirected to /auth/login.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "ok" })
}
