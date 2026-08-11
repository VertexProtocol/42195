// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { ProfileScreen } from "./profile-screen"
import type { SyncStatus, UserProfile } from "@/lib/types"

/**
 * The Connected services card.
 *
 * It used to be four stacked rows — "Strava connected", "Last synced", a
 * full-width Sync button and a re-sync row — to say that syncing works and
 * when it last ran. These tests hold the shape it collapsed to, and the thing
 * that shape depends on: the status being readable as text rather than as the
 * colour of an icon.
 */

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  }),
}))

const USER: UserProfile = {
  id: "user-1",
  display_name: "Test Runner",
  email: "runner@example.com",
  avatar_url: null,
}

function syncedMinutesAgo(minutes: number): SyncStatus {
  return {
    state: "success",
    last_sync_at: new Date(Date.now() - minutes * 60 * 1000).toISOString(),
    error_message: null,
  }
}

function renderProfile(options: { syncStatus?: SyncStatus; connected?: boolean } = {}) {
  return render(
    <I18nProvider>
      <ProfileScreen
        user={USER}
        syncStatus={options.syncStatus ?? syncedMinutesAgo(54)}
        stravaConnected={options.connected ?? true}
        onSync={() => {}}
        onFullSync={() => {}}
        onConnectStrava={async () => ({ ok: true })}
        onSignOut={() => {}}
        onOpenGetStarted={() => {}}
      />
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ analysis: null }) })),
  )
})

describe("ProfileScreen — connected services", () => {
  it("states the sync status in words, not only in the colour of an icon", () => {
    renderProfile({ syncStatus: syncedMinutesAgo(54) })
    expect(screen.getByText("Synced 54m ago")).toBeTruthy()
  })

  it("says so plainly when a connected account has never synced", () => {
    renderProfile({
      syncStatus: { state: "never", last_sync_at: null, error_message: null },
    })
    expect(screen.getByText("Never synced")).toBeTruthy()
  })

  it("no longer spends a row on a standalone 'Last synced' label", () => {
    renderProfile()
    expect(screen.queryByText("Last synced")).toBeNull()
    expect(screen.queryByText("Strava connected")).toBeNull()
  })

  it("keeps sync, reconnect and re-sync reachable", () => {
    renderProfile()
    expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /full re-sync/i })).toBeTruthy()
  })

  it("still surfaces a sync error, which the layout must not swallow", () => {
    renderProfile({
      syncStatus: {
        state: "error",
        last_sync_at: null,
        error_message: "Strava said no",
      },
    })
    const alert = screen.getByRole("alert")
    expect(within(alert).getByText("Strava said no")).toBeTruthy()
  })

  it("offers no sync actions at all when Strava is not connected", () => {
    renderProfile({ connected: false })
    expect(screen.getByText("Strava not connected")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /sync now/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /full re-sync/i })).toBeNull()
  })
})
