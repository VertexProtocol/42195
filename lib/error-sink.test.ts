import { describe, it, expect } from "vitest"
import { errorFields } from "./error-sink"

/**
 * Anything can be thrown, and the reporter's job is to keep evidence of
 * whatever it was. A shape it does not recognise must still produce a row —
 * refusing to record an unfamiliar throw would lose the one trace of exactly
 * the failure nobody predicted.
 */
describe("errorFields", () => {
  it("keeps the message and the stack of a real error", () => {
    const error = new Error("supabaseKey is required.")
    const fields = errorFields(error)
    expect(fields.message).toBe("supabaseKey is required.")
    expect(fields.stack).toContain("supabaseKey is required.")
  })

  it("keeps a thrown string", () => {
    expect(errorFields("no hashed_token returned")).toEqual({
      message: "no hashed_token returned",
      stack: null,
    })
  })

  it("keeps a plain object, which is the shape Supabase errors arrive in", () => {
    const fields = errorFields({ message: "duplicate key", code: "23505" })
    expect(fields.message).toContain("duplicate key")
    expect(fields.message).toContain("23505")
  })

  it("survives something that cannot be serialised", () => {
    const circular: Record<string, unknown> = { name: "loop" }
    circular.self = circular
    // JSON.stringify throws on this; the reporter must not.
    expect(() => errorFields(circular)).not.toThrow()
    expect(errorFields(circular).message.length).toBeGreaterThan(0)
  })

  it("truncates rather than storing an unbounded stack", () => {
    const error = new Error("x")
    error.stack = "y".repeat(20_000)
    expect(errorFields(error).stack).toHaveLength(8_000)
  })

  it("truncates an unbounded message", () => {
    expect(errorFields("z".repeat(5_000)).message).toHaveLength(2_000)
  })
})
