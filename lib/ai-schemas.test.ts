import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * Guards the hand-written structured-outputs schemas against drift.
 *
 * These schemas mirror zod schemas by hand because the SDK's zodOutputFormat()
 * calls z.toJSONSchema(), a zod v4 API, and this project is on zod 3. Nothing
 * else checks that they stay valid, and the API rejects an invalid one at
 * request time — in production, on a user's first generation.
 *
 * They live inside route handlers, which in the App Router may only export the
 * HTTP verbs, so the source is read rather than imported.
 */

const ROOT = join(__dirname, "..")

const SCHEMAS: Array<[name: string, file: string, constant: string]> = [
  ["training-plan", "app/api/ai/training-plan/route.ts", "PLAN_DRAFT_JSON_SCHEMA"],
  ["race-strategy", "app/api/ai/race-strategy/route.ts", "RACE_STRATEGY_JSON_SCHEMA"],
  ["plan-check", "app/api/ai/plan-check/route.ts", "PLAN_CHECK_JSON_SCHEMA"],
  ["weekly-review", "app/api/ai/weekly-review/route.ts", "WEEKLY_REVIEW_JSON_SCHEMA"],
]

/** Constraints structured outputs does not support; they belong in zod instead. */
const UNSUPPORTED = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "multipleOf"]

type Node = Record<string, unknown>

function extractSchema(file: string, constant: string): Node {
  const src = readFileSync(join(ROOT, file), "utf8")
  const declaration = `const ${constant} = `
  const start = src.indexOf(declaration)
  if (start === -1) throw new Error(`${constant} not found in ${file}`)
  const bodyStart = start + declaration.length
  const end = src.indexOf("} as const", bodyStart)
  if (end === -1) throw new Error(`${constant} in ${file} is not closed with "} as const"`)
  return eval(`(${src.slice(bodyStart, end)}})`) as Node
}

/** Walks the schema, collecting every constraint violation with its path. */
function violations(node: unknown, path: string, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found
  const n = node as Node

  for (const key of UNSUPPORTED) {
    if (key in n) found.push(`${path}: unsupported constraint "${key}"`)
  }

  if (n.type === "object") {
    if (n.additionalProperties !== false) found.push(`${path}: missing additionalProperties: false`)
    const properties = (n.properties ?? {}) as Node
    const names = Object.keys(properties)
    if (!Array.isArray(n.required)) {
      found.push(`${path}: missing required`)
    } else {
      for (const key of n.required as string[]) {
        if (!names.includes(key)) found.push(`${path}: required "${key}" is not a property`)
      }
      for (const key of names) {
        if (!(n.required as string[]).includes(key)) {
          found.push(`${path}.${key}: property is not in required`)
        }
      }
    }
    for (const key of names) violations(properties[key], `${path}.${key}`, found)
  }

  if (n.type === "array") violations(n.items, `${path}[]`, found)
  if (Array.isArray(n.anyOf)) n.anyOf.forEach((alt, i) => violations(alt, `${path}.anyOf[${i}]`, found))

  return found
}

describe.each(SCHEMAS)("%s structured-output schema", (_name, file, constant) => {
  const schema = extractSchema(file, constant)

  it("satisfies every structured-outputs constraint", () => {
    expect(violations(schema, constant)).toEqual([])
  })

  it("describes an object with properties", () => {
    expect(schema.type).toBe("object")
    expect(Object.keys((schema.properties ?? {}) as Node).length).toBeGreaterThan(0)
  })
})
