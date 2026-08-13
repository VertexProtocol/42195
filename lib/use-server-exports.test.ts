import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * A `"use server"` module may only export async functions.
 *
 * Every export from such a file becomes a callable server endpoint, so a
 * plain value has nowhere to go and the module throws where it is evaluated.
 * A constant among the actions is an easy thing to add and an expensive thing
 * to have added: `/auth/finish` exported one, and the screen failed before a
 * single line of the action ran — no database call, nothing in any log the
 * account could open, and a digest as the only evidence.
 *
 * `next build` compiles it happily, so this is the check that would have
 * caught it. Types are exempt because they are erased before any of this
 * matters.
 */

const ROOTS = ["app", "lib", "components", "hooks"]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

/** Exports that are not `async function` and not a type. */
function offendingExports(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /^export\s/.test(line))
    .filter((line) => !/^export\s+(type|interface)\s/.test(line))
    .filter((line) => !/^export\s+async\s+function\s/.test(line))
}

describe('every "use server" module', () => {
  const serverModules = ROOTS.flatMap(sourceFiles).filter((path) =>
    /^\s*["']use server["']/.test(readFileSync(path, "utf8")),
  )

  it("is actually found by this test, so a green run means something", () => {
    // Without this, deleting every action would read as a pass.
    expect(serverModules.length).toBeGreaterThan(0)
  })

  it.each(serverModules)("%s exports only async functions", (path) => {
    expect(offendingExports(readFileSync(path, "utf8"))).toEqual([])
  })
})
