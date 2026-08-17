# The marketplace layer

The template gives a new repo the right shape. It does not stop standards being
copy-pasted, and it does not let a fix reach repos created last month. That is
what the marketplace is for.

## The split

| Lives in | What | Updates |
|---|---|---|
| **Plugin** (`frontend-standards@vertex`) | The design workflow skill, the version-check hook, the UI gate hook | Centrally — fix once, every repo gets it |
| **This repo** | `CLAUDE.md`, `PRODUCT.md`, CI, the vendored `impeccable/` skill and its pin | Per repo, on its own schedule |

The vendored Impeccable skill stays **per repo on purpose**. Its version is a
dependency of the code that assumes it, so it should move when that repo chooses,
not when the marketplace publishes.

## Why the standard is a hook, not a rule

Plugins cannot ship `.claude/rules/` — rules load only from a project or user
directory. And a skill alone is not equivalent, because skills are model-invoked:
whether the standard applies would depend on the model judging it relevant, which
is the failure the plugin exists to prevent.

So the plugin uses a `PreToolUse` hook with `additionalContext`, which fires
before the edit lands regardless of what the model decided. That is the guarantee
a rule gives. The skill carries the long-form workflow for when it is opened.

The gate fires once per session and matches on **file extension, not directory** —
`app/` is a Next.js route tree in some repos and a Python package in others.

## Setup, once per org

```bash
# publish the marketplace repo
gh repo create VertexProtocol/claude-marketplace --private --source=. --push
```

## Per repo

`.claude/settings.json` already declares it:

```json
{
  "extraKnownMarketplaces": {
    "vertex": { "source": { "source": "github", "repo": "VertexProtocol/claude-marketplace" } }
  },
  "enabledPlugins": { "frontend-standards@vertex": true }
}
```

Once the folder is trusted, Claude Code adds the marketplace with no further
prompt. **It does not auto-install the plugin** — since v2.1.195 a plugin from an
external source has to be installed explicitly, and Claude Code prints the
command:

```bash
claude plugin install frontend-standards@vertex
```

One command per clone, not zero. Enable auto-update on the marketplace in
`/plugin` → **Marketplaces** so later fixes arrive on their own.

## Changing a standard

Edit the plugin, bump `version` in `plugin.json`, push. Repos pick it up on their
next update. Do not edit the stub rule in a repo — that is how the drift starts
again.
