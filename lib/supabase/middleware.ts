import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

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

  // Redirect unauthenticated users to login for protected routes
  if (!user && !isAuthRoute && !isApiRoute) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/auth/login"
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from auth pages
  // Allow /auth/callback (code exchange) and /auth/sign-up-success through always
  const isAuthPassthrough =
    pathname === "/auth/sign-up-success" || pathname === "/auth/callback"

  if (user && isAuthRoute && !isAuthPassthrough) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = "/"
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}
