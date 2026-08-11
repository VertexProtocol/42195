/**
 * Loads project modules — including the module-private internals of an AI
 * route — outside of Next.
 *
 * A Next.js `route.ts` may only export HTTP handlers, so `buildPrompt` and the
 * prompt constants are unreachable from outside. Rather than reimplement them in
 * the harness — which would test a copy of the pipeline instead of the pipeline —
 * this writes a temporary sibling module containing the route's own source plus
 * an export statement for the names we need, and loads it through Vite, reusing
 * the same `@` alias the project's tests use.
 *
 * `next/server` and `next/headers` are stubbed: the route imports them at module
 * scope but the harness never calls the HTTP handlers.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createServer } from "vite"

const STUB_DIR = join(process.cwd(), "node_modules", ".smoke-stubs")

function writeStubs() {
  mkdirSync(STUB_DIR, { recursive: true })
  writeFileSync(
    join(STUB_DIR, "next-server.mjs"),
    "export class NextResponse { static json() { throw new Error('not used') } }\n" +
      "export class NextRequest {}\n",
  )
  writeFileSync(
    join(STUB_DIR, "next-headers.mjs"),
    "export function cookies() { throw new Error('not used') }\n",
  )
}

/** Opens a Vite SSR loader over the project. Call `close()` when finished. */
export async function openLoader() {
  writeStubs()
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, watch: null },
    resolve: {
      alias: {
        "next/server": join(STUB_DIR, "next-server.mjs"),
        "next/headers": join(STUB_DIR, "next-headers.mjs"),
        "@": process.cwd(),
      },
    },
  })
  const temps = []

  return {
    /** Loads any project module, e.g. "lib/training-sessions.ts". */
    load: (relPath) => server.ssrLoadModule(join(process.cwd(), relPath)),

    /**
     * Loads an AI route with extra module-private names exported.
     * @param {string} route  e.g. "training-plan"
     * @param {string[]} names  module-private names to re-export
     */
    loadRouteInternals: async (route, names) => {
      const routeDir = join(process.cwd(), "app", "api", "ai", route)
      const entry = join(routeDir, "__smoke_internals.ts")
      // A sibling of route.ts, so every relative and aliased import resolves the
      // same way. Next only treats `route.ts` itself as a handler, and the file
      // is removed again on close().
      const source = readFileSync(join(routeDir, "route.ts"), "utf8")
      writeFileSync(entry, `${source}\nexport { ${names.join(", ")} }\n`)
      temps.push(entry)
      return server.ssrLoadModule(entry)
    },

    close: async () => {
      await server.close()
      for (const t of temps) rmSync(t, { force: true })
    },
  }
}
