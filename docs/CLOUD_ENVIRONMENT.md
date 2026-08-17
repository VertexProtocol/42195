# Cloud environment runbook

Cloud sessions (claude.ai/code, `claude --cloud`, routines, the mobile app) run
in a **cloud environment**: a saved config holding network access, environment
variables and a setup script. Local Claude Code has none of this — it uses your
machine's network. Everything here applies only to cloud sessions.

## Diagnose first

Symptoms of an egress block: `EGRESS_BLOCKED` from WebFetch, or from curl:

```
curl: (56) CONNECT tunnel failed, response 403
```

Confirm it is policy and not the destination being down:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

`recentRelayFailures` names the host and the reason. `connect_rejected` with
`gateway answered 403 to CONNECT` is a **policy denial** — the host is not on
this environment's allowlist. Do not retry it, and do not route around it; the
fix is configuration, below.

A `405` instead means a tool sent plain HTTP rather than CONNECT (usually an old
axios, or something reading `HTTP_PROXY`). A certificate error means the tool is
not reading the CA bundle at `/root/.ccr/ca-bundle.crt`. Neither is a policy
problem. `/root/.ccr/README.md` covers both.

## Access levels

| Level | Outbound |
|---|---|
| **None** | Nothing through the session's network |
| **Trusted** (default) | Allowlisted domains: package registries, GitHub, cloud SDKs |
| **Full** | Any domain |
| **Custom** | Your own list, optionally plus the defaults |

GitHub goes through a **separate proxy** and is unaffected by this setting. MCP
connector traffic travels via Anthropic's servers, so connector hosts never need
allowlisting either.

## Change it

There is no settings page and no direct URL. The environment selector is the
only entry point.

1. Open [claude.ai/code](https://claude.ai/code).
2. Click the **cloud icon showing the environment's name**, in the row above the
   message box. This repo's sessions run in the environment named **42195**
   (`env_01RwBhss5jMmDKSkvm8s5sWo`).
3. Under **Cloud**, hover the environment → **gear** icon.
4. Set **Network access** to **Custom**.
5. List domains in **Allowed domains**, one per line. A leading `*.` matches
   every subdomain.
6. **Tick "Also include default list of common package managers."**
7. Save, then **start a new session.**

### Two steps that are easy to get wrong

- **Leaving the defaults unticked** replaces the Trusted list rather than adding
  to it. npm, PyPI and crates all disappear and the build breaks in a way that
  looks unrelated to the change.
- **Config is read once, at container start.** The session you are in keeps the
  network it booted with. Verify in a *new* session.

## Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<host>/
```

`200`/`301`/`404` means the tunnel opened — you reached the host. `000` with
`CONNECT tunnel failed, response 403` means still blocked.

## One allowlist per environment

**Each environment carries its own list. There is no organization-level
allowlist**, and no managed setting that adds domains to every environment.
Unblocking a host in one environment does nothing for the others.

So per-project environments multiply this work by the number of projects. Unless
projects genuinely need different network access, environment variables or setup
scripts, prefer **one shared environment** across them. Environments are the
same kind of thing as this template: worth standardising once rather than
drifting per project.

## Environment variables

The same dialog has an **Environment variables** box, `.env` format, one
`KEY=value` per line. Values are copied into the session once at startup, so
edits apply to sessions you start afterwards.

Anyone using the environment can read them and there is no secrets store — do
not put credentials here.

## Impeccable and Worlds

Frontend repos vendor the Impeccable design skill. Most of it works fully
offline: all its commands, and the deterministic detector.

**Worlds is the exception.** Its catalogue of human-reviewed design directions
is not in the skill bundle. It resolves from a local catalogue
(`IMPECCABLE_CATALOG_DIR`) or from `impeccable.style`; with neither, the seed
degrades and deals **no challengers**, which is the entire point of the feature.

To enable it, add to **Allowed domains**:

```
impeccable.style
*.impeccable.style
impeccable.pro
*.impeccable.pro
```

If an approval is needed, this is the scope to state: the roll makes **one
`GET` to `https://impeccable.style/api/roll`**, carrying scope, mode, an
eight-hex seed key and a re-roll counter. No project files, prompts, code or
conversation context are transmitted, and nothing is written. `DO_NOT_TRACK` or
`IMPECCABLE_NO_TELEMETRY` disables the anonymous choice ping.

`impeccable.pro` is included because the fuller Worlds decks are a paid tier.

**Until it is unblocked**, a session must say plainly that the roll ran degraded
rather than present it as a full roll — and it still owes design directions as a
published artifact, hand-authored. `.claude/rules/frontend-design.md` carries
that obligation.

**Or skip all of it**: run Claude Code locally, where no egress policy applies,
and Worlds works with no configuration.
