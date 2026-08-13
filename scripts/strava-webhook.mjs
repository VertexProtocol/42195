/**
 * Register, inspect and remove the app's Strava push subscription.
 *
 * The webhook endpoint at app/api/webhooks/strava has been there for a while.
 * The subscription that would make Strava send anything to it had not — there
 * was no code anywhere that created one, so the endpoint sat waiting for
 * events that were never going to arrive, and every activity reached the app
 * only when the runner pressed Sync.
 *
 * Creating one is a one-time act against Strava's API, done with the app's own
 * credentials rather than any athlete's. That makes it ops work, not app code,
 * which is why it lives here as a script rather than in a route.
 *
 * Usage:
 *   node scripts/strava-webhook.mjs view
 *   node scripts/strava-webhook.mjs create https://your-domain/api/webhooks/strava
 *   node scripts/strava-webhook.mjs delete <subscription_id>
 *
 * Reads STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_WEBHOOK_VERIFY_TOKEN
 * from the environment. See docs/strava-webhook.md for the full sequence.
 */

const API = "https://www.strava.com/api/v3/push_subscriptions"

const clientId = process.env.STRAVA_CLIENT_ID
const clientSecret = process.env.STRAVA_CLIENT_SECRET
const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN

function die(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

if (!clientId || !clientSecret) {
  die("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set.")
}

const [command, argument] = process.argv.slice(2)

/** Strava answers errors as JSON when it can and HTML when it cannot. */
async function readBody(res) {
  const text = await res.text()
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text.slice(0, 500)
  }
}

async function view() {
  const url = new URL(API)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("client_secret", clientSecret)

  const res = await fetch(url)
  if (!res.ok) die(`Strava answered ${res.status}:\n${await readBody(res)}`)

  const subs = await res.json()
  if (subs.length === 0) {
    console.log("\n  No subscription. Strava is not sending this app anything.\n")
    return
  }
  for (const sub of subs) {
    console.log(
      `\n  id ${sub.id}\n  callback  ${sub.callback_url}\n  created   ${sub.created_at}\n  updated   ${sub.updated_at}\n`,
    )
  }
  // The environment the app reads has to agree with what Strava will send, or
  // every event is rejected as forged by the subscription_id check in the route.
  const configured = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID
  if (configured && !subs.some((s) => String(s.id) === configured)) {
    console.warn(
      `  WARNING: STRAVA_WEBHOOK_SUBSCRIPTION_ID is ${configured}, which is not\n` +
        `  one of the subscriptions above. The route will reject every event.\n`,
    )
  }
  if (!configured) {
    console.warn(
      `  Note: STRAVA_WEBHOOK_SUBSCRIPTION_ID is unset. Events are accepted\n` +
        `  without the forgery check — set it to the id above.\n`,
    )
  }
}

async function create(callbackUrl) {
  if (!callbackUrl) die("Pass the callback URL: create https://your-domain/api/webhooks/strava")
  if (!verifyToken) {
    // Without it the route's GET handler compares the incoming token against
    // undefined and answers 403, so Strava's validation callback fails and the
    // subscription is never created. Better to say so than to watch it fail.
    die("STRAVA_WEBHOOK_VERIFY_TOKEN must be set, and must match the deployment's.")
  }
  if (!callbackUrl.startsWith("https://")) {
    die("Strava will only call an https URL, and will not call localhost.")
  }

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: callbackUrl,
      verify_token: verifyToken,
    }),
  })

  if (!res.ok) {
    const body = await readBody(res)
    // Strava allows exactly one subscription per application, and says so with
    // a validation error rather than a dedicated status.
    const hint = body.includes("already exists")
      ? "\n\n  An application may only hold one subscription. Run `view`, then\n  `delete <id>` before creating a new one."
      : ""
    die(`Strava answered ${res.status}:\n${body}${hint}`)
  }

  const sub = await res.json()
  console.log(
    `\n  Created subscription ${sub.id}\n\n` +
      `  Set STRAVA_WEBHOOK_SUBSCRIPTION_ID=${sub.id} in the deployment and redeploy,\n` +
      `  so the route can tell real events from forged ones.\n`,
  )
}

async function remove(id) {
  if (!id) die("Pass the subscription id: delete <id>")
  const url = new URL(`${API}/${id}`)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("client_secret", clientSecret)

  const res = await fetch(url, { method: "DELETE" })
  // A successful delete is 204 with no body.
  if (!res.ok) die(`Strava answered ${res.status}:\n${await readBody(res)}`)
  console.log(`\n  Deleted subscription ${id}.\n`)
}

switch (command) {
  case "view":
    await view()
    break
  case "create":
    await create(argument)
    break
  case "delete":
    await remove(argument)
    break
  default:
    die(
      "Usage:\n" +
        "    node scripts/strava-webhook.mjs view\n" +
        "    node scripts/strava-webhook.mjs create https://your-domain/api/webhooks/strava\n" +
        "    node scripts/strava-webhook.mjs delete <subscription_id>",
    )
}
