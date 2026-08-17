# Vendored skills

Third-party skills are vendored here rather than installed globally, so they
survive a fresh machine or an ephemeral cloud container, and so their version is
pinned alongside the code that assumes it.

Record every one. An unpinned vendored skill is an undeclared dependency.

| Skill | Upstream | Pinned rev | Skill version | License |
|---|---|---|---|---|
| `impeccable/` | https://github.com/pbakaus/impeccable | `9ce0350` | `4.1.1` | Apache-2.0 |

## Two version numbers, and the trap

The **skill** and the **npm CLI** are released separately. At the time of
writing the skill was `4.1.1` while `npm view impeccable version` returned
`3.6.0`. Checking npm tells you nothing about whether the skill is current.

The authority is the `version:` field in `SKILL.md`. Upstream's copy:

```bash
curl -s https://raw.githubusercontent.com/pbakaus/impeccable/main/plugin/skills/impeccable/SKILL.md | grep -m1 '^version:'
grep -m1 '^version:' .claude/skills/impeccable/SKILL.md
```

The `SessionStart` hook at `.claude/hooks/impeccable-version-check.mjs` runs
exactly this comparison and reports drift. It fails open: offline or blocked, it
says nothing.

## Updating

The normal path is `npx impeccable skills install`, which downloads from
`impeccable.style`. **In a sandboxed or cloud session that host is usually
blocked by egress policy**, so use the git path, which needs only GitHub:

```bash
git clone --depth 1 https://github.com/pbakaus/impeccable /tmp/impeccable
rm -rf .claude/skills/impeccable
cp -R /tmp/impeccable/plugin/skills/impeccable .claude/skills/
cp /tmp/impeccable/LICENSE .claude/skills/impeccable/LICENSE
git -C /tmp/impeccable rev-parse --short HEAD    # record as the pinned rev
```

Then update the table above and commit the bump **on its own**, separate from
product changes, so it can be reverted alone.

Also worth running after an update: `/impeccable doctor`, which reports drift
between the repo's Impeccable artifacts (`PRODUCT.md`, `DESIGN.md`, config,
hooks) and what the new version expects.

## Why staying current matters

Features arrive without announcement. Worlds — the design-direction roll — was
added in a minor release; a session running an older skill simply does not know
it exists and silently does the lesser thing. That is what the version hook is
for.
