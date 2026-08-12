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

// Nor does jsdom ship ResizeObserver, which every responsive chart container
// constructs on mount. Without it the chart throws during the commit phase and
// takes the whole render with it, so a screen that merely contains a chart
// cannot be tested at all. It reports nothing, which is the same thing a real
// container does before it has been measured.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver
}

afterEach(async () => {
  if (typeof document === "undefined") return
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})
