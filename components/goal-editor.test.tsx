// @vitest-environment jsdom

import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { GoalEditor } from "./goal-editor"
import type { Goal, GoalCategory } from "@/lib/types"

/**
 * The goal type selector.
 *
 * The Plan screen used to offer one add-button per category, which asked the
 * same question this selector asks a moment later. Collapsing that to a single
 * button rests on the selector being the one place a goal's type is decided —
 * including when editing, which no button leads into. These tests hold that
 * claim: the selector exists in both modes, it reflects the goal it opened on,
 * and it reshapes the form rather than only recording a preference.
 */

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    name: "Oslo Marathon",
    goal_category: "event_training",
    target_distance_km: 42.195,
    target_date: "2026-09-19",
    target_time_seconds: null,
    start_date: "2026-05-01",
    is_active: true,
    is_starred: false,
    display_order: 0,
    created_at: "2026-01-01",
    ...overrides,
  } as Goal
}

function renderEditor(props: {
  goal?: Goal | null
  isNew: boolean
  defaultCategory?: GoalCategory
}) {
  return render(
    <I18nProvider>
      <GoalEditor
        goal={props.goal ?? null}
        isNew={props.isNew}
        defaultCategory={props.defaultCategory}
        open
        onSave={() => {}}
        onClose={() => {}}
      />
    </I18nProvider>,
  )
}

const typeButton = (name: RegExp) => screen.getByRole("button", { name })

describe("GoalEditor — goal type selector", () => {
  it("offers both types on a new goal", () => {
    renderEditor({ isNew: true })
    expect(typeButton(/performance/i)).toBeTruthy()
    expect(typeButton(/event training/i)).toBeTruthy()
  })

  it("defaults to performance when opened without a category", () => {
    renderEditor({ isNew: true })
    expect(typeButton(/performance/i).getAttribute("aria-pressed")).toBe("true")
    expect(typeButton(/event training/i).getAttribute("aria-pressed")).toBe("false")
  })

  it("honours a pre-selected category from the caller", () => {
    // The Today screen still opens straight into an event goal.
    renderEditor({ isNew: true, defaultCategory: "event_training" })
    expect(typeButton(/event training/i).getAttribute("aria-pressed")).toBe("true")
  })

  it("is still offered when editing, which no add-button leads into", () => {
    renderEditor({ goal: makeGoal(), isNew: false })
    expect(typeButton(/performance/i)).toBeTruthy()
    expect(typeButton(/event training/i)).toBeTruthy()
  })

  it("opens on the existing goal's own type", () => {
    renderEditor({ goal: makeGoal({ goal_category: "event_training" }), isNew: false })
    expect(typeButton(/event training/i).getAttribute("aria-pressed")).toBe("true")
    expect(typeButton(/performance/i).getAttribute("aria-pressed")).toBe("false")
  })

  it("opens on a performance goal's type too, rather than a constant", () => {
    renderEditor({ goal: makeGoal({ goal_category: "performance" }), isNew: false })
    expect(typeButton(/performance/i).getAttribute("aria-pressed")).toBe("true")
    expect(typeButton(/event training/i).getAttribute("aria-pressed")).toBe("false")
  })

  it("reshapes the form rather than only recording a preference", () => {
    renderEditor({ isNew: true })
    expect(screen.getByLabelText("Goal name")).toBeTruthy()

    fireEvent.click(typeButton(/event training/i))
    expect(screen.getByLabelText("Event name")).toBeTruthy()
    expect(screen.queryByLabelText("Goal name")).toBeNull()
  })

  it("explains the type it is currently on", () => {
    renderEditor({ isNew: true })
    expect(screen.getByText(/a timed benchmark/i)).toBeTruthy()

    fireEvent.click(typeButton(/event training/i))
    expect(screen.getByText(/preparing for a race or event/i)).toBeTruthy()
  })
})
