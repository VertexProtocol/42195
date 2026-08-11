# AI smoke tests

Standalone scripts that exercise the six AI routes against the **real** Anthropic
API. They are not part of `npm test` — they cost money and need a key — but they
are the only thing that answers questions unit tests structurally cannot: whether
the API accepts a parameter combination, and whether a `cache_control` breakpoint
does anything.

```bash
export SMOKE_ANTHROPIC_API_KEY=sk-ant-...

node scripts/smoke/smoke.mjs tokens          # cacheable prefix vs model minimum
node scripts/smoke/smoke.mjs smoke           # one real request per route form
node scripts/smoke/smoke.mjs cache           # two identical calls, read cache_read
node scripts/smoke/plan-pipeline.mjs         # full plan generation + invariants
```

Both accept route/focus names to narrow the run, e.g.
`node scripts/smoke/smoke.mjs cache coach` or
`node scripts/smoke/plan-pipeline.mjs volume:low`.

## Why they read the route source

The prompts, tool definitions and JSON schemas live inside `route.ts` files, which
may only export HTTP handlers. Copying them into the scripts would let the routes
drift while the smoke test kept passing — the exact failure these scripts exist to
catch. So `extract.mjs` reads the constants out of the source, and `load-route.mjs`
loads `buildPrompt` and friends through Vite using the same `@` alias the unit
tests use. Both fail loudly rather than falling back if a name moves.

## What each script covers

`smoke.mjs` mirrors every route's request shape exactly — same model, `max_tokens`,
`thinking`, `output_config`, `temperature`, system blocks, tools and schema — and
reports `stop_reason` and usage. `plan-pipeline.mjs` runs the whole
`POST /api/ai/training-plan` pipeline minus Supabase: real safety engine, real
volume computation, real prompt, real Opus 5 call, real assembly, then asserts the
plan's invariants (weekly sums, long-run cap, week count, pace source, no leaked
safety text, and the per-focus rules).

## Cache minimums

The minimum cacheable prefix is per-model and **not** monotonic across
generations. Current values used by `smoke.mjs`:

| Model | Minimum |
| --- | ---: |
| `claude-opus-5` | 512 |
| `claude-haiku-4-5` | 4096 |

The prefix renders as `tools` → `system`, and a structured-output schema shares
it, so both count toward the minimum — which is why the coach's 8 tool schemas
and the Opus routes' JSON schemas decide whether those routes cache at all.
