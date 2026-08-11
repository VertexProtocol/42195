import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    // Node by default: the training engine is pure functions and the suite is
    // mostly that, so it should not pay for a DOM. Component tests opt in with
    // a `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    // React Testing Library mounts into a document that persists between
    // tests unless it is torn down; without this every render stacks up in
    // the same body and queries start matching the previous test's markup.
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
