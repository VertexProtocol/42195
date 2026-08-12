// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { SharedGoalEntry } from "./shared-goal-entry"

/**
 * The row that offers a group, and what it does when the offer is stale.
 *
 * The screen is handed its group rather than fetching one, so it can be
 * looking at a goal that joined a group a moment ago and does not know it.
 * Pressing the button then asks the server to create a second group for a
 * goal that already has one, and the server refuses with the id of the group
 * it already has. Reporting that as a failure is how the button came to look
 * dead to the one runner most likely to press it.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderEntry(onOpen = vi.fn(), onCreated = vi.fn()) {
  render(
    <I18nProvider>
      <SharedGoalEntry goalId="g1" group={null} onOpen={onOpen} onCreated={onCreated} />
    </I18nProvider>,
  )
  return { onOpen, onCreated }
}

describe("creating a group from a goal", () => {
  it("opens the group the server says the goal already has", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "That goal is already in a group", id: "existing-group" }),
      }),
    )
    const { onOpen, onCreated } = renderEntry()

    fireEvent.click(screen.getByRole("button"))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("existing-group"))
    // The rest of the app is behind too, so it is told to re-read.
    expect(onCreated).toHaveBeenCalled()
  })

  it("opens a group it did create", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "new-group" }) }),
    )
    const { onOpen } = renderEntry()

    fireEvent.click(screen.getByRole("button"))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new-group"))
  })

  it("still reports a real failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    )
    const { onOpen } = renderEntry()

    fireEvent.click(screen.getByRole("button"))

    // A 409 carries somewhere to go; a 500 does not, and must not be silent.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onOpen).not.toHaveBeenCalled()
  })
})
