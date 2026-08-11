/**
 * Pulls the live prompt, tool and JSON-schema constants straight out of the
 * route files.
 *
 * The alternative was to copy them into the smoke script, which would have made
 * the script pass while the routes drifted underneath it — exactly the failure
 * mode the smoke test exists to catch. The constants are module-private (a
 * Next.js `route.ts` may only export HTTP handlers and route config), so the
 * script reads the source instead of importing it.
 *
 * The extractors are deliberately strict: anything they cannot read exactly —
 * a template literal that grew an `${interpolation}`, a renamed constant — is a
 * thrown error, not a silent fallback.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROUTES = join(process.cwd(), "app", "api", "ai")

export function routeSource(route) {
  return readFileSync(join(ROUTES, route, "route.ts"), "utf8")
}

/**
 * Reads `const NAME = \`...\`` and returns the literal text.
 * Throws if the literal interpolates — an interpolated prompt is not a constant
 * and cannot be token-counted or cached as one.
 */
export function extractTemplateLiteral(source, name) {
  const decl = `const ${name} = \``
  const start = source.indexOf(decl)
  if (start === -1) throw new Error(`extract: no template literal named ${name}`)

  let i = start + decl.length
  let out = ""
  while (i < source.length) {
    const ch = source[i]
    if (ch === "\\") {
      out += source[i] + source[i + 1]
      i += 2
      continue
    }
    if (ch === "$" && source[i + 1] === "{") {
      throw new Error(`extract: ${name} contains an interpolation — not a constant prompt`)
    }
    if (ch === "`") {
      // Unescape the few sequences a prompt literal can legally carry.
      return out.replace(/\\`/g, "`").replace(/\\\$/g, "$").replace(/\\\\/g, "\\")
    }
    out += ch
    i++
  }
  throw new Error(`extract: unterminated template literal for ${name}`)
}

/**
 * Reads `const NAME[: type] = { ... }` or `= [ ... ]` and evaluates it.
 * Only handles the plain data literals these routes actually use; TypeScript's
 * `as const` assertions are stripped first because they are the one piece of
 * type syntax that appears inside them.
 */
export function extractObjectLiteral(source, name) {
  const re = new RegExp(`const ${name}(?::[^=]+)? = ([\\[{])`)
  const m = re.exec(source)
  if (!m) throw new Error(`extract: no object/array literal named ${name}`)

  const open = m[1]
  const close = open === "{" ? "}" : "]"
  let i = m.index + m[0].length - 1
  let depth = 0
  let inString = null
  const startIdx = i

  for (; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) break
    }
  }
  if (depth !== 0) throw new Error(`extract: unbalanced literal for ${name}`)

  const literal = source.slice(startIdx, i + 1).replace(/\s+as const\b/g, "")
  return new Function(`return (${literal})`)()
}
