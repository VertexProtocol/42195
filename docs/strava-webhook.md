# Strava webhook — the one-time setup

The endpoint at `app/api/webhooks/strava/route.ts` receives activity events.
Strava will not send it anything until the app holds a **push subscription**
pointing at it. Creating that subscription is a manual, one-time act against
Strava's API, done with the app's own credentials — not any athlete's.

Until it exists, activities only arrive when a runner presses Sync. Nothing in
the app reports the subscription's absence, because from the app's side there
is nothing to see: a webhook that is never called looks exactly like a webhook
with nothing to say.

## What has to be true

| Variable | Where | Why |
|---|---|---|
| `STRAVA_CLIENT_ID` | deployment + your shell | identifies the app to Strava |
| `STRAVA_CLIENT_SECRET` | deployment + your shell | same |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | deployment + your shell | any string you choose; the two must match |
| `STRAVA_WEBHOOK_SUBSCRIPTION_ID` | deployment | set *after* creating, from the id Strava returns |

`STRAVA_WEBHOOK_VERIFY_TOKEN` has to be set **on the deployment before you
create the subscription**. Strava validates the callback URL by calling it with
the token; the route compares it against the environment variable, and if that
variable is unset the comparison is against `undefined`, the route answers 403,
and the subscription is never created.

## Creating it

```bash
# 1. Confirm there is nothing there yet. Strava allows one per application.
STRAVA_CLIENT_ID=… STRAVA_CLIENT_SECRET=… \
  node scripts/strava-webhook.mjs view

# 2. Create it against the production URL. Strava will only call https, and
#    will not call localhost.
STRAVA_CLIENT_ID=… STRAVA_CLIENT_SECRET=… STRAVA_WEBHOOK_VERIFY_TOKEN=… \
  node scripts/strava-webhook.mjs create https://your-domain/api/webhooks/strava

# 3. Put the returned id in STRAVA_WEBHOOK_SUBSCRIPTION_ID and redeploy.
```

Step 3 is what lets the route tell a real event from a forged one. Skipping it
is not fatal — the check is skipped when the variable is unset — but it leaves
the endpoint accepting anything shaped like a Strava event.

## Checking it later

```bash
STRAVA_CLIENT_ID=… STRAVA_CLIENT_SECRET=… node scripts/strava-webhook.mjs view
```

`view` also warns when `STRAVA_WEBHOOK_SUBSCRIPTION_ID` names a subscription
that does not exist — the state in which every incoming event is rejected as
forged, which looks identical to no subscription at all.

## Things worth knowing

**One per application.** Creating a second fails. To repoint at a new domain,
`delete <id>` then `create` with the new URL.

**Preview deployments cannot have their own.** One subscription, one callback
URL, so webhooks are a production-only path. Previews sync manually.

**Deauthorization comes through here too.** When an athlete revokes access,
Strava sends an `athlete`/`delete` event, and the route deletes every
Strava-derived record for that user — required by the Strava API Agreement
§5.4. Without a subscription that event never arrives, and the data is never
deleted. This is the part of the missing subscription that is not merely a
convenience.

**The 200 must be fast.** Strava wants a response within two seconds and
retries when it does not get one; a subscription whose deliveries keep timing
out is eventually deleted. The route answers first and does the fetching in
`after()`, so the work does not sit in front of the response.
