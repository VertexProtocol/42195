import { createClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client — bypasses RLS.
 * For server-side only operations (Strava token storage, admin sync).
 * Never expose this client or the service role key to the browser.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
