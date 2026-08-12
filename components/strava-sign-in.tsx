"use client"

import { useState } from "react"
import { useI18n } from "@/lib/i18n"
import { ConnectWithStravaButton } from "@/components/strava-brand"

/**
 * Strava, at the top of both signed-out screens.
 *
 * The button keeps Strava's own wording. Their brand guidelines supply one
 * OAuth button and it says "Connect with Strava" — there is no sanctioned
 * "sign in" variant, and inventing one is not ours to do. So the line under
 * it carries the meaning instead: this is how you get in, and your runs come
 * with you.
 *
 * A full document load rather than a client navigation: the destination is a
 * route handler that redirects off-origin to Strava.
 */
export function StravaSignIn({ next }: { next: string }) {
  const { t } = useI18n()
  const [going, setGoing] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <ConnectWithStravaButton
          disabled={going}
          connecting={going}
          onClick={() => {
            setGoing(true)
            const query = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
            window.location.href = `/api/auth/strava${query}`
          }}
        />
        <p className="text-center text-micro leading-relaxed text-muted-foreground">
          {t("auth.stravaBlurb")}
        </p>
      </div>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-micro text-muted-foreground">{t("auth.or")}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
