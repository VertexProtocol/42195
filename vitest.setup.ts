/**
 * Shared test setup.
 *
 * Runs for every test file, including the node-environment ones, so it must
 * not assume a DOM exists. React Testing Library's auto-cleanup is opt-in when
 * `globals` is enabled, and skipping it leaks mounted components between tests
 * in the same file.
 */

import { afterEach } from "vitest"

afterEach(async () => {
  if (typeof document === "undefined") return
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})
