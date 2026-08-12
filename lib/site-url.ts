import { headers } from "next/headers"

/**
 * The origin to build auth links against.
 *
 * The configured site URL is the only fully trusted source for the host, and
 * it is what a link in an email has to use — the request that sends the email
 * and the click that comes back days later are not the same visit. The origin
 * header is the local-development fallback.
 *
 * Trailing slashes are stripped: every path appended to this starts with one.
 */
export async function resolveSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/+$/, "")

  const headersList = await headers()
  return (headersList.get("origin") ?? "").replace(/\/+$/, "")
}
