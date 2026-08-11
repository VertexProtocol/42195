/**
 * Shared test setup.
 *
 * Runs for every test file, including the node-environment ones, so it must
 * not assume a DOM exists. React Testing Library's auto-cleanup is opt-in when
 * `globals` is enabled, and skipping it leaks mounted components between tests
 * in the same file.
 */

import { afterEach } from "vitest"

// jsdom ships no matchMedia, and components that respect prefers-reduced-motion
// call it during their mount effect — so a missing stub fails the render rather
// than the behaviour under test. Reports "no preference", which is the branch
// that exercises the real animation path.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

afterEach(async () => {
  if (typeof document === "undefined") return
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})
