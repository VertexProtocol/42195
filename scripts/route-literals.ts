import { readFileSync } from "fs"
import { join } from "path"

/**
 * Extracts top-level literals out of App Router route files.
 *
 * The system prompts, structured-output schemas and tool definitions the AI
 * routes send all live inside `app/api/ai/*\/route.ts`, which may only export
 * the HTTP verbs — so nothing can import them. `lib/ai-schemas.test.ts` already
 * works around that by reading the source; this module generalises the same
 * trick so the smoke script can mirror a route's real request instead of
 * keeping a second copy of every prompt that would silently drift.
 */

const ROOT = join(__dirname, "..")

/**
 * Scans forward from `start` to the index just past the literal beginning
 * there, tracking string, template and comment state so a bracket inside a
 * prompt sentence does not end the scan early.
 */
function endOfLiteral(src: string, start: number): number {
  const opener = src[start]
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : null

  if (opener === "`") {
    for (let i = start + 1; i < src.length; i++) {
      if (src[i] === "\\") i++
      else if (src[i] === "`") return i + 1
    }
    throw new Error("unterminated template literal")
  }

  if (!closer) throw new Error(`unsupported literal starting with ${JSON.stringify(opener)}`)

  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]

    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") i++
        else if (src[i] === ch) break
      }
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i)
      if (i === -1) break
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1
      continue
    }

    if (ch === opener) depth++
    else if (ch === closer) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error("unterminated literal")
}

/** Returns the source text of `const <name> = <literal>` in `file`. */
export function literalSource(file: string, name: string): string {
  const src = readFileSync(join(ROOT, file), "utf8")
  const declaration = new RegExp(`^const ${name}\\b[^=]*=\\s*`, "m")
  const match = declaration.exec(src)
  if (!match) throw new Error(`${name} not found in ${file}`)
  const start = match.index + match[0].length
  return src.slice(start, endOfLiteral(src, start))
}

/** The text of a template-literal constant, e.g. a system prompt. */
export function templateLiteral(file: string, name: string): string {
  const source = literalSource(file, name)
  if (!source.startsWith("`")) throw new Error(`${name} in ${file} is not a template literal`)
  if (/\$\{/.test(source)) {
    throw new Error(`${name} in ${file} interpolates; the smoke script cannot mirror it verbatim`)
  }
  return source.slice(1, -1).replace(/\\`/g, "`").replace(/\\\$/g, "$")
}

/** The value of an object/array constant, with TypeScript `as const` stripped. */
export function valueLiteral<T>(file: string, name: string): T {
  const source = literalSource(file, name).replace(/\s+as const\b/g, "")
  return eval(`(${source})`) as T
}
