#!/usr/bin/env node
/**
 * SessionStart hook — is the vendored Impeccable skill the current one?
 *
 * The skill and the npm CLI carry SEPARATE version numbers (skill 4.1.1 while
 * the CLI was 3.6.0). `npm view impeccable version` therefore answers a
 * different question and will tell you you are current when you are not. The
 * authority for the skill version is the frontmatter of SKILL.md upstream.
 *
 * Fails open, always. A version check that blocks a session because the network
 * is down is worse than the drift it detects.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const local = join(root, '.claude/skills/impeccable/SKILL.md')
const UPSTREAM =
  'https://raw.githubusercontent.com/pbakaus/impeccable/main/plugin/skills/impeccable/SKILL.md'

const versionOf = (text) => (text.match(/^version:\s*(\S+)/m) || [])[1]

if (!existsSync(local)) process.exit(0)   // skill not vendored here — nothing to check

const mine = versionOf(readFileSync(local, 'utf8'))
if (!mine) process.exit(0)

try {
  const res = await fetch(UPSTREAM, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) process.exit(0)
  const latest = versionOf(await res.text())
  if (latest && latest !== mine) {
    console.log(
      `Impeccable skill is ${mine}; upstream is ${latest}. ` +
      `Newer versions add features you will not otherwise know exist — Worlds arrived this way. ` +
      `Update per .claude/skills/VENDORED.md before starting frontend work, and tell the user you did.`
    )
  }
} catch {
  // Offline, blocked, or slow. Not a problem worth a message.
}
process.exit(0)
