import { safeNext } from "@/lib/auth-redirect"
import { SignUpSuccess } from "./sign-up-success"

/**
 * The wait between creating an account and confirming it.
 *
 * A server component so the two parameters can be read without pulling the
 * whole screen out of prerendering; the screen itself is a client component
 * because everything the runner reads here is translated.
 */
export default async function SignUpSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>
}) {
  const { email, next } = await searchParams
  return <SignUpSuccess email={email ?? null} next={safeNext(next)} />
}
