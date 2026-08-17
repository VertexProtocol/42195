---
paths:
  - "**/*.{tsx,jsx,vue,svelte,css,scss}"
  - "**/components/**"
  - "DESIGN.md"
---

# Frontend work runs through Impeccable

Use the vendored skill at `.claude/skills/impeccable/`, not freehand design.
Setup once per session:
`node .claude/skills/impeccable/scripts/context.mjs`.

**Work that sets or changes a visual direction proposes options first** — several
complete directions on this product's real screens with identical real content,
the incumbent included, published as an artifact, then stop until the user picks.
This is the default and does not need to be asked for.

The full workflow — command routing, Worlds, the update path — is the
`frontend-design` skill from the `frontend-standards` plugin. If that skill is
not available, the plugin is not installed:

```bash
claude plugin install frontend-standards@vertex
```

This stub exists because plugins cannot ship rules; it is deliberately short so
it rarely changes. The content it points at updates centrally.
