/**
 * The form's state, kept out of the action file on purpose.
 *
 * `actions.ts` carries `"use server"`, and such a module may only export
 * async functions — everything exported from it becomes a callable server
 * endpoint, so there is nowhere for a plain value to go. Exporting the idle
 * constant from there threw at module evaluation, before a single line of the
 * action ran, which is why the screen failed with nothing reaching the
 * database and no trace beyond a digest.
 *
 * Types alone would have been fine, since they are erased. The constant is
 * what could not stay, and the types come with it so the next person adding
 * one has an obvious place to put it.
 */

export type SaveEmailStatus = "idle" | "invalid" | "taken" | "failed"

export interface SaveEmailState {
  status: SaveEmailStatus
}

export const SAVE_EMAIL_IDLE: SaveEmailState = { status: "idle" }
