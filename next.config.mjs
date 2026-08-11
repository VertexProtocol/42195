/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development'

/**
 * Supabase is the only third-party origin the browser talks to directly.
 *
 * A hosted project lives on `<ref>.supabase.co`, which the wildcard below
 * already covers in every environment. The explicit origin is added when the
 * variable is visible to the config at boot, so that a custom Supabase domain
 * or a self-hosted instance keeps working; if you move to one of those, make
 * sure the variable is a real environment variable rather than only present in
 * a `.env` file the runtime does not load.
 */
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : ''
  } catch {
    return ''
  }
})()

const connectSrc = [
  "'self'",
  supabaseOrigin,
  supabaseOrigin.replace(/^https:/, 'wss:'),
  'https://*.supabase.co',
  'wss://*.supabase.co',
  // Vercel Speed Insights / Analytics beacon.
  'https://vitals.vercel-insights.com',
  // Next's dev server talks to itself over websockets for fast refresh.
  isDev ? 'ws://localhost:*' : '',
]
  .filter(Boolean)
  .join(' ')

const csp = [
  "default-src 'self'",
  // Next inlines its bootstrap and route payload scripts. Without a nonce
  // (which would force every static page dynamic) 'unsafe-inline' is required;
  // the value of this directive here is that it still pins scripts to our own
  // origin. Dev additionally needs eval for React Fast Refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // Tailwind ships in a stylesheet, but Next and Radix both set inline styles.
  "style-src 'self' 'unsafe-inline'",
  // next/font self-hosts Figtree and JetBrains Mono, so no external font host.
  "font-src 'self'",
  // Profile avatars come from whichever identity provider the account used, so
  // the host is not knowable in advance. Restricted to TLS.
  "img-src 'self' blob: data: https:",
  `connect-src ${connectSrc}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Belt and braces alongside frame-ancestors, for older browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
