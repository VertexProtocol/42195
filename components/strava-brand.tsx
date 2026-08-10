"use client"

/**
 * Official Strava branding components per Strava Brand Guidelines.
 * https://developers.strava.com/guidelines/
 *
 * - "Connect with Strava" button (required for OAuth flows)
 * - "Powered by Strava" attribution (required where Strava data is displayed)
 * - Strava wordmark logo
 */

/** Strava brand orange */
const STRAVA_ORANGE = "#FC4C02"

/**
 * Strava wordmark SVG — horizontal "STRAVA" text logo.
 * Reproduces the official vector from Strava's brand toolkit.
 */
function StravaWordmark({ className, color = "currentColor" }: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 80 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Strava"
    >
      {/* S */}
      <path
        d="M5.2 5.6C3.7 5.2 2.8 5 2.8 4.1c0-.8.8-1.3 1.9-1.3 1.3 0 2.1.6 2.2 1.7h2.8C9.5 2.2 7.7.8 4.7.8 2.1.8 0 2.3 0 4.3c0 2.4 2.1 3 4.4 3.5 1.6.4 2.6.7 2.6 1.6 0 .9-.9 1.4-2.1 1.4-1.5 0-2.4-.7-2.6-2H0C.2 11.3 2.1 13 5 13c2.7 0 4.8-1.4 4.8-3.7 0-2.5-2.2-3.1-4.6-3.7z"
        fill={color}
      />
      {/* T */}
      <path d="M15.4 3.1h-3.2V1.1h9.2v2h-3.2V12.7h-2.8V3.1z" fill={color} />
      {/* R */}
      <path
        d="M23 1.1h5.3c2.8 0 4.3 1.5 4.3 3.6 0 1.8-1 3-2.7 3.4l3 4.6h-3.2l-2.7-4.3h-1.3v4.3H23V1.1zm5 5.5c1.2 0 1.8-.6 1.8-1.7 0-1-.6-1.7-1.8-1.7h-2.2v3.4h2.2z"
        fill={color}
      />
      {/* A */}
      <path d="M38.8 1.1h2.9l4.8 11.6h-3l-1-2.5h-4.7l-1 2.5h-2.9l4.9-11.6zm2.6 7.1l-1.2-3.2-1.3 3.2h2.5z" fill={color} />
      {/* V */}
      <path d="M47.5 1.1h3l2.8 7.5 2.8-7.5h2.9l-4.3 11.6h-2.9L47.5 1.1z" fill={color} />
      {/* A */}
      <path d="M63.7 1.1h2.9l4.8 11.6h-3l-1-2.5h-4.7l-1 2.5h-2.9l4.9-11.6zm2.6 7.1l-1.2-3.2-1.3 3.2h2.5z" fill={color} />
    </svg>
  )
}

/**
 * Official Strava icon — the arrow/chevron mark.
 */
function StravaIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Strava"
    >
      <path
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066l-2.084 4.116z"
        fill={color}
        opacity="0.6"
      />
      <path
        d="M10.233 13.828L15.387 3.656 20.537 13.828h-3.066l-2.084-4.116-2.089 4.116h-3.065z"
        fill={color}
      />
    </svg>
  )
}

// ─── "Connect with Strava" Button ──────────────────────────────────────────

interface ConnectWithStravaProps {
  onClick: () => void
  disabled?: boolean
  connecting?: boolean
}

/**
 * Official "Connect with Strava" button per brand guidelines.
 * Uses Strava orange (#FC4C02) background with white text and logo.
 */
export function ConnectWithStravaButton({ onClick, disabled, connecting }: ConnectWithStravaProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="press flex h-11 w-full items-center justify-center gap-2.5 rounded-md px-5 text-label font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
      style={{ backgroundColor: STRAVA_ORANGE }}
    >
      {connecting ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      ) : (
        <StravaIcon size={18} color="white" />
      )}
      {connecting ? "Connecting…" : "Connect with Strava"}
    </button>
  )
}

// ─── "Powered by Strava" Attribution ───────────────────────────────────────

interface PoweredByStravaProps {
  className?: string
}

/**
 * "Powered by Strava" attribution badge — required wherever Strava data is displayed.
 * Available in light (default) and dark mode variants via CSS.
 */
export function PoweredByStrava({ className = "" }: PoweredByStravaProps) {
  return (
    <div className={`flex items-center justify-center gap-1.5 py-1 ${className}`}>
      <span className="text-micro font-medium text-muted-foreground">Powered by</span>
      <StravaWordmark className="h-3 w-auto" color={STRAVA_ORANGE} />
    </div>
  )
}

/**
 * Inline "Powered by Strava" for use in compact spaces (e.g. card footers).
 */
export function PoweredByStravaInline({ className = "" }: PoweredByStravaProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <StravaIcon size={12} color={STRAVA_ORANGE} />
      <span className="text-micro text-muted-foreground">via Strava</span>
    </span>
  )
}
