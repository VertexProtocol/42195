import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import { DEFAULT_AFTER_AUTH, safeNext } from "@/lib/auth-redirect"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh session — must call getUser() to keep the session alive
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute = pathname.startsWith("/auth")
  const isApiRoute = pathname.startsWith("/api")

  // Redirect unauthenticated users to login for protected routes, carrying
  // where they were going. An invite link (`/?invite=…`) is the common case:
  // it arrives at a signed-out browser, and without this the runner signs up
  // and lands on Today with the invite gone from the URL.
  if (!user && !isAuthRoute && !isApiRoute) {
    const loginUrl = new URL("/auth/login", request.url)
    const next = safeNext(`${pathname}${request.nextUrl.search}`)
    if (next !== DEFAULT_AFTER_AUTH) loginUrl.searchParams.set("next", next)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from auth pages.
  // Allow through routes that must be reachable with an active session:
  //   /auth/callback       — exchanges the recovery/OAuth code for a session
  //   /auth/reset-password — requires the recovery session to call updateUser()
  //
  // /auth/sign-up-success is deliberately not on this list. It says "check
  // your email", and the only way to hold a session and ask for it is to have
  // just confirmed — so for the one runner it was let through for, it was the
  // wrong screen. Confirming now lands in the app; anyone who reaches this
  // path with a session goes there too.
  //
  // /auth/finish is on it: it asks a runner who has just signed in through
  // Strava for an address, so it is only ever reached with a session.
  const isAuthPassthrough =
    pathname === "/auth/callback" ||
    pathname === "/auth/reset-password" ||
    pathname === "/auth/finish"

  if (user && isAuthRoute && !isAuthPassthrough) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = "/"
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}
