import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-redirect"
import { isPlaceholderEmail } from "@/lib/strava-account"
import { FinishSignUp } from "./finish-sign-up"

/**
 * The one thing Strava cannot tell us.
 *
 * There is no email scope in Strava's API, so an account that arrived that way
 * has no address anyone can reach — no way back in if the Strava account ever
 * goes, and nothing for the app to write to. This screen asks for one, once,
 * while the reason is still obvious.
 *
 * It asks for an address and nothing else. No password: the runner has a way
 * in already, and a second credential invented at this moment is the setup
 * that signing in with Strava was meant to avoid. Profile can set one later,
 * for anyone who wants a way in that does not go through Strava.
 *
 * Anyone who does not need it — an account with a real address, which is every
 * account made through the email form — is sent straight on.
 */
export default async function FinishSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = safeNext(next)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login")
  if (!isPlaceholderEmail(user.email)) redirect(destination)

  return <FinishSignUp next={destination} />
}
