/**
 * The resend button's state, kept out of the action file.
 *
 * Same reason as `app/auth/finish/state.ts`: a `"use server"` module may only
 * export async functions, and a plain constant among them throws at module
 * evaluation. This screen never surfaced it only because the project
 * auto-confirms addresses, so sign-up returns a session and nobody is sent
 * here — it would have failed the first time somebody was.
 */

export type ResendStatus = "idle" | "sent" | "throttled" | "failed"

export interface ResendState {
  status: ResendStatus
}

export const RESEND_IDLE: ResendState = { status: "idle" }
