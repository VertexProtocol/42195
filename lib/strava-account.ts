/**
 * What the app knows about a Strava athlete, and what it calls them.
 *
 * Separate from `strava-identity` because Profile reads
 * `isPlaceholderEmail` in the browser, and that module reaches for
 * `next/headers` — which a client component may not.
 */

/** Strava gives us these on the token exchange. There is no email among them. */
export interface StravaAthlete {
  id: number
  firstname?: string | null
  lastname?: string | null
  profile_medium?: string | null
  profile?: string | null
}

/**
 * The address an account is created with before the runner gives us a real
 * one. `.invalid` is reserved by RFC 2606 and can never resolve, so this can
 * never accidentally deliver mail to a stranger.
 */
export function placeholderEmailFor(athleteId: number): string {
  return `athlete-${athleteId}@strava.invalid`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith("@strava.invalid")
}

/** What Strava calls this athlete, or something honest when it says nothing. */
export function athleteDisplayName(athlete: StravaAthlete): string {
  const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim()
  return name || `Athlete ${athlete.id}`
}
