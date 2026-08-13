import { createServiceClient } from "@/lib/supabase/service"

/**
 * Where a server error goes so that somebody can read it.
 *
 * `console.error` writes to runtime logs this deployment's plan does not
 * expose, which is how a failure on `/auth/finish` ended up diagnosed from
 * Supabase's auth log and the shape of the row it left behind — and still not
 * explained. A row in `app_errors` is readable in the SQL editor, which is a
 * place that exists.
 *
 * Server only: it holds the service-role key. Never import this from a client
 * component.
 */

/** Long enough to hold a real stack, short enough that a loop cannot fill a disk. */
const MAX_MESSAGE = 2_000
const MAX_STACK = 8_000

/**
 * What is worth keeping about a thrown value.
 *
 * Anything can be thrown, not only an Error, so this takes `unknown` and
 * always produces something — a caught string is still evidence, and the
 * reporter deciding it does not recognise the shape would throw away the one
 * record of the failure.
 */
export function errorFields(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, MAX_MESSAGE),
      stack: error.stack ? error.stack.slice(0, MAX_STACK) : null,
    }
  }
  if (typeof error === "string") return { message: error.slice(0, MAX_MESSAGE), stack: null }
  try {
    return { message: JSON.stringify(error).slice(0, MAX_MESSAGE), stack: null }
  } catch {
    // Circular, or something with a throwing toJSON. Say that rather than nothing.
    return { message: String(error).slice(0, MAX_MESSAGE), stack: null }
  }
}

/**
 * Records a failure, and never becomes one.
 *
 * Every path out of here is a return. An error reporter that throws turns one
 * broken screen into two, and the second is harder to explain than the first —
 * so a database that is unreachable, a table that is missing, and a key that
 * is unset all end the same way: the console line still happens, and the
 * request carries on.
 */
export async function recordServerError(
  context: string,
  error: unknown,
  meta: { userId?: string | null } = {},
): Promise<void> {
  const { message, stack } = errorFields(error)

  // Still to the console. If logs ever become readable, this is where the
  // record lives that predates the table.
  console.error(`[${context}]`, message)

  try {
    const { error: insertError } = await createServiceClient().from("app_errors").insert({
      context,
      message,
      stack,
      user_id: meta.userId ?? null,
    })
    if (insertError) {
      console.error("[error-sink] Could not record error:", insertError.message)
    }
  } catch (sinkError) {
    console.error(
      "[error-sink] Could not record error:",
      sinkError instanceof Error ? sinkError.message : String(sinkError),
    )
  }
}
