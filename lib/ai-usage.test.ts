import { describe, it, expect, vi, afterEach } from "vitest"
import { logAiUsage, sumAiUsage } from "./ai-usage"

afterEach(() => vi.restoreAllMocks())

describe("logAiUsage", () => {
  it("reports the four fields that matter, with meta alongside", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    logAiUsage("training-plan", {
      input_tokens: 1200, output_tokens: 800,
      cache_read_input_tokens: 1100, cache_creation_input_tokens: 0,
    }, { goalId: "g1" })

    expect(log).toHaveBeenCalledWith("[ai-usage] training-plan", {
      goalId: "g1", input: 1200, output: 800, cacheRead: 1100, cacheWrite: 0,
    })
  })

  it("treats absent cache fields as zero rather than undefined", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    logAiUsage("weekly-review", { input_tokens: 10, output_tokens: 5 })

    expect(log.mock.calls[0][1]).toMatchObject({ cacheRead: 0, cacheWrite: 0 })
  })
})

describe("sumAiUsage", () => {
  it("adds up the turns of a tool-use loop", () => {
    const total = sumAiUsage([
      { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900 },
      { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 900 },
      { input_tokens: 300, output_tokens: 20, cache_creation_input_tokens: 400 },
    ])
    expect(total).toEqual({
      input_tokens: 600, output_tokens: 150,
      cache_read_input_tokens: 1800, cache_creation_input_tokens: 400,
    })
  })

  it("returns zeros for no turns", () => {
    expect(sumAiUsage([])).toEqual({
      input_tokens: 0, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    })
  })
})
