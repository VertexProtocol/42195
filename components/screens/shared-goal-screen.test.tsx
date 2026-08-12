// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { SharedGoalScreen } from "./shared-goal-screen"
import type { SharedGoalView, SharedGoalMemberView } from "@/app/api/shared-goals/[id]/route"

/**
 * The group screen's rows.
 *
 * The ordinary row is the easy one. These are the states where the feature
 * either tells the truth or quietly invents a number about someone: a member
 * with no plan, a member whose block has not completed a week, a member who
 * has stopped, and a member who is ahead. A zero in place of a dash would be a
 * claim about a runner that nothing in the data supports.
 */

const NOW = new Date("2026-06-15T12:00:00Z")

function member(overrides: Partial<SharedGoalMemberView> = {}): SharedGoalMemberView {
  return {
    userId: "u1",
    name: "Kari L.",
    initial: "K",
    isSelf: false,
    positionPct: 101.1,
    adherenceDone: 96,
    adherenceTarget: 95,
    updatedAt: NOW.toISOString(),
    outcome: null,
    ...overrides,
  }
}

function view(members: SharedGoalMemberView[], overrides: Partial<SharedGoalView> = {}): SharedGoalView {
  return {
    id: "g1",
    name: "Oslo Marathon",
    raceDate: "2026-09-20",
    distanceKm: 42.195,
    metric: "adherence",
    isOwner: false,
    finished: false,
    members,
    pendingInvites: [],
    ...overrides,
  }
}

async function renderScreen(v: SharedGoalView) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => v })) as unknown as typeof fetch,
  )
  render(
    <I18nProvider>
      <SharedGoalScreen groupId="g1" onBack={() => {}} />
    </I18nProvider>,
  )
  await waitFor(() => expect(screen.getByText("Oslo Marathon")).toBeTruthy())
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("SharedGoalScreen rows", () => {
  it("shows the measure and the ratio it came from", async () => {
    await renderScreen(view([member({ isSelf: true })]))
    expect(screen.getByText("101 %")).toBeTruthy()
    // The second line is the same measurement before it became a fraction, so
    // there is no second percentage to confuse it with.
    expect(screen.getByText("96 / 95 km")).toBeTruthy()
    expect(screen.queryByText("101 % of plan")).toBeNull()
  })

  it("shows a dash, not a zero, for a member with nothing to measure", async () => {
    await renderScreen(
      view([
        member({
          userId: "u2",
          name: "Tone R.",
          initial: "T",
          positionPct: null,
          adherenceDone: null,
          adherenceTarget: null,
        }),
      ]),
    )
    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.queryByText("0 %")).toBeNull()
    expect(screen.getByText("No plan to measure against yet")).toBeTruthy()
  })

  it("says how long a member has been quiet", async () => {
    const stale = new Date(NOW.getTime() - 23 * 86_400_000).toISOString()
    await renderScreen(
      view([member({ userId: "u3", name: "Jonas H.", initial: "J", positionPct: 31, adherenceDone: 64, adherenceTarget: 210, updatedAt: stale })]),
    )
    expect(screen.getByText("31 %")).toBeTruthy()
    expect(screen.getByText("64 / 210 km")).toBeTruthy()
    expect(screen.getByText("23 days quiet")).toBeTruthy()
  })

  it("leaves a figure above 100 standing", async () => {
    // Overreaching is a real thing that happened, and it is usually the start
    // of an injury. The lane stops at the line; the number does not.
    await renderScreen(
      view([member({ positionPct: 130, adherenceDone: 130, adherenceTarget: 100 })]),
    )
    expect(screen.getByText("130 %")).toBeTruthy()
  })

  it("names the reader rather than repeating their display name", async () => {
    await renderScreen(view([member({ isSelf: true, name: "Simen W." })]))
    expect(screen.getByText("You")).toBeTruthy()
    expect(screen.queryByText("Simen W.")).toBeNull()
  })

  it("does not number the rows", async () => {
    await renderScreen(
      view([
        member({ userId: "a", name: "Kari L.", initial: "K", positionPct: 101 }),
        member({ userId: "b", name: "Maria B.", initial: "M", positionPct: 87 }),
      ]),
    )
    // Sorted, but no placings: "you have done 87 % of your plan" is a training
    // log and "you are second" is a competition.
    expect(screen.queryByText("1")).toBeNull()
    expect(screen.queryByText("2")).toBeNull()
  })

  it("offers invite links only to the owner", async () => {
    await renderScreen(view([member({ isSelf: true })], { isOwner: false }))
    expect(screen.queryByText("New link")).toBeNull()
    expect(screen.getByText("Leave the group")).toBeTruthy()
  })

  it("calls the owner's exit disbanding, because that is what it does", async () => {
    await renderScreen(view([member({ isSelf: true })], { isOwner: true }))
    expect(screen.getByText("New link")).toBeTruthy()
    expect(screen.getByText("Disband the group")).toBeTruthy()
  })

  it("draws a marker for every measured member and none for the rest", async () => {
    await renderScreen(
      view([
        member({ userId: "a", name: "Kari L.", initial: "K", positionPct: 101, isSelf: true }),
        member({ userId: "b", name: "Maria B.", initial: "M", positionPct: 87 }),
        member({ userId: "c", name: "Tone R.", initial: "T", positionPct: null }),
      ]),
    )
    const lane = screen.getByRole("img", { name: /group's lane/i })
    expect(lane.getAttribute("aria-label")).toContain("You 101%")
    expect(lane.getAttribute("aria-label")).toContain("Maria B. 87%")
    expect(lane.getAttribute("aria-label")).not.toContain("Tone R.")
  })
})

describe("handing over an invite link", () => {
  const withInvite = view([member({ isSelf: true })], {
    isOwner: true,
    pendingInvites: [
      {
        id: "i1",
        token: "tok_abcdefghijklmnop",
        expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      },
    ],
  })

  it("shows the link itself, so it is reachable whatever the clipboard does", async () => {
    await renderScreen(withInvite)
    // The bug this replaces: the token lived only inside a button, so a
    // refused clipboard write left no way at all to get the link.
    expect(screen.getByText(/\/\?invite=tok_abcdefghijklmnop$/)).toBeTruthy()
  })

  it("says copied only when it copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await renderScreen(withInvite)

    fireEvent.click(screen.getByText("Send"))

    await waitFor(() =>
      expect(
        screen.getByText("Could not copy it. Select the link above and copy it by hand."),
      ).toBeTruthy(),
    )
    expect(screen.queryByText("Copied")).toBeNull()
  })

  it("confirms when it did copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await renderScreen(withInvite)

    fireEvent.click(screen.getByText("Send"))

    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("?invite=tok_abcdefghijklmnop"))
  })

  it("copies from the button beside the link, without the share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const share = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText }, share })
    await renderScreen(withInvite)

    fireEvent.click(screen.getByLabelText("Copy"))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("?invite=tok_abcdefghijklmnop"),
      ),
    )
    // The point of this button: the share sheet takes over the screen, and
    // sometimes the link is going somewhere the sheet has never heard of.
    expect(share).not.toHaveBeenCalled()
  })

  it("says how long the link has left", async () => {
    await renderScreen(withInvite)
    expect(screen.getByText("Works for 7 more days")).toBeTruthy()
  })

  it("does not say '1 days' on the last one", async () => {
    const almostGone = view([member({ isSelf: true })], {
      isOwner: true,
      pendingInvites: [
        {
          id: "i1",
          token: "tok_abcdefghijklmnop",
          expiresAt: new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
        },
      ],
    })
    await renderScreen(almostGone)
    expect(screen.getByText("Stops working within a day")).toBeTruthy()
  })
})

describe("after the race has been run", () => {
  const finished = (outcome: SharedGoalMemberView["outcome"]) =>
    view([member({ isSelf: true, name: "Kari L.", outcome })], { finished: true })

  it("says the race was run rather than counting down to it", async () => {
    await renderScreen(finished("reached"))
    expect(screen.getByText(/Run on/)).toBeTruthy()
  })

  it("gives each runner the verdict their own goal gives them", async () => {
    await renderScreen(finished("reached"))
    expect(screen.getByText("Achieved")).toBeTruthy()
  })

  it("does not dress a finished block up as a failure", async () => {
    await renderScreen(finished("ended"))
    // The word the runner's own screen uses. An event goal is not passed or
    // failed by the app, and the group does not get to say otherwise.
    expect(screen.getByText("Ended")).toBeTruthy()
    expect(screen.queryByText("Achieved")).toBeNull()
  })

  it("keeps 'nothing recorded' apart from 'fell short'", async () => {
    await renderScreen(finished(null))
    // Only one of those two is about the running.
    expect(screen.getByText("No result recorded")).toBeTruthy()
    expect(screen.queryByText("Ended")).toBeNull()
  })

  it("drops the quiet-days nudge, which is about training still to do", async () => {
    const stale = view(
      [member({ isSelf: true, outcome: "ended", updatedAt: "2026-01-01T00:00:00Z" })],
      { finished: true },
    )
    await renderScreen(stale)
    expect(screen.queryByText(/quiet/i)).toBeNull()
  })
})

/**
 * Leaving.
 *
 * The set of groups is held by the app, not by this screen, so a leave that
 * only closes the screen leaves the goal behind it still offering the group.
 * That looked like the leave had failed: it had worked, and the only way to
 * see it was to reload the page.
 */
describe("SharedGoalScreen — leaving", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function renderForLeave(isOwner: boolean) {
    const v = view([member({ isSelf: true })], { isOwner })
    const order: string[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") order.push("delete")
      return { ok: true, json: async () => v }
    })
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    const onBack = vi.fn(() => order.push("back"))
    const onLeft = vi.fn(async () => {
      order.push("told")
    })

    render(
      <I18nProvider>
        <SharedGoalScreen groupId="g1" onBack={onBack} onLeft={onLeft} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByText("Oslo Marathon")).toBeTruthy())
    return { onBack, onLeft, order, fetchMock }
  }

  it("tells the app the group is gone before closing the screen", async () => {
    const { onBack, onLeft, order } = await renderForLeave(false)

    fireEvent.click(screen.getByText("Leave the group"))

    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(onLeft).toHaveBeenCalledTimes(1)
    // Order matters: the goal this screen closes onto must already know the
    // group is gone, or it paints a frame still offering it.
    expect(order).toEqual(["delete", "told", "back"])
  })

  it("says the same when the owner disbands", async () => {
    const { onLeft, order } = await renderForLeave(true)

    fireEvent.click(screen.getByText("Disband the group"))

    await waitFor(() => expect(onLeft).toHaveBeenCalled())
    expect(order).toEqual(["delete", "told", "back"])
  })

  it("keeps the screen open, and says nothing, when the leave fails", async () => {
    const v = view([member({ isSelf: true })], { isOwner: false })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE"
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => v },
      ) as unknown as typeof fetch,
    )
    const onBack = vi.fn()
    const onLeft = vi.fn()
    render(
      <I18nProvider>
        <SharedGoalScreen groupId="g1" onBack={onBack} onLeft={onLeft} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByText("Oslo Marathon")).toBeTruthy())

    fireEvent.click(screen.getByText("Leave the group"))

    // A refresh here would be a lie about a group the runner is still in.
    await waitFor(() => expect(screen.getByText("Leave the group")).toBeTruthy())
    expect(onLeft).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })
})
