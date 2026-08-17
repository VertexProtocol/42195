---
paths:
  - "**/*.{tsx,jsx,vue,svelte,css,scss}"
  - "**/components/**"
  - "**/app/**"
  - "DESIGN.md"
---

# Frontend design work runs through Impeccable

This repo vendors the Impeccable design skill at `.claude/skills/impeccable/`.
Frontend and design work uses it. Do not design freehand and do not treat the
skill as optional context — invoking it is the first step, not a fallback after
the code is already written.

## Before you touch UI

1. Run the skill's setup once per session:
   `node .claude/skills/impeccable/scripts/context.mjs`
2. Load the reference for the command that owns the request (table below).
3. Only then edit.

## Which command

| Request | Command |
|---|---|
| New surface, or a replacement visual world | `/impeccable` → new-work |
| Plan UX before code | `shape` |
| UX review, hierarchy, clarity | `critique` |
| a11y, performance, responsive, tokens | `audit` |
| Final pass before shipping | `polish` |
| Too safe / too loud / too complex | `bolder` · `quieter` · `distill` |
| Motion, colour, type, spacing | `animate` · `colorize` · `typeset` · `layout` |
| Errors, i18n, edge cases | `harden` |
| Copy, labels, error messages | `clarify` |
| Derive DESIGN.md from existing code | `document` |

Run the detector over changed UI before you call the work done:
`node .claude/skills/impeccable/scripts/detect.mjs --json <paths>`

## Design directions are proposed, never assumed

**Any work that sets or changes a visual direction produces options for the user
to choose from, as a published artifact, before any implementation.** This is the
default and does not need to be asked for.

That means:

- **Deal several complete directions, not one.** Each is a whole graphic system
  with its own palette, type, laws and refusals — not a palette swap on a shared
  layout. Include the incumbent as one card, so what would be traded away is
  visible.
- **Render them on this product's real screens with real content**, identical
  across every option, so the comparison is design and nothing else. Never
  lorem, never a generic template preview.
- **Publish as an artifact and hand over the link.** A direction described in
  prose has not been proposed. If both themes are real use conditions, show both.
- **Stop there and wait.** Do not begin the re-skin until the user names the one
  they want.

Skipping straight to implementation on a redesign is a failure even if the
result is good, because it takes the choice away from the person whose product
it is.

## Worlds

Worlds is Impeccable's own version of the above: human-reviewed design
directions dealt as challengers against the model's ideas. Prefer it over
hand-rolled proposals when it is reachable — it is a reviewed deck rather than
one designer's taste.

Its catalogue is **not** in the skill bundle; it resolves from
`https://impeccable.style/api/roll`, or from a local catalogue via
`IMPECCABLE_CATALOG_DIR`. Without one, the seed degrades and deals **no
challengers** — it says so explicitly in its own output.

In a sandboxed or cloud session, `impeccable.style` is usually blocked by egress
policy. Then: say plainly that the roll ran degraded, do not present it as a full
roll, and fall back to hand-authored proposals under the rules above — the
artifact is still owed. To unblock permanently, allow `impeccable.style` in the
environment's network policy; the roll's only request is one `GET` carrying
scope, mode, a seed key and a re-roll counter, with no project data.

## Staying current

A `SessionStart` hook compares the vendored skill against upstream and reports
drift. If it reports a newer version, update before starting design work — new
features arrive silently otherwise, and you cannot use what you do not know
exists. See `.claude/skills/VENDORED.md`.

The skill and the npm CLI are versioned **separately**. `npm view impeccable
version` answers the CLI question and will look current while the skill is
stale. The skill's version is the `version:` field in its `SKILL.md`.
