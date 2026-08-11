import type { Metadata, Viewport } from 'next'
import { Figtree, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { I18nProvider } from '@/lib/i18n'
import { ServiceWorkerRegistration } from '@/components/sw-register'
import { AuthListener } from '@/components/auth-listener'
import './globals.css'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '42195 — Training tracker',
  description: 'Track your running training progress toward your next goal',
  manifest: '/manifest.json',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e0d9d1' },
    { media: '(prefers-color-scheme: dark)', color: '#17110e' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`bg-background ${figtree.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        {/*
          THESIS: a training log that reads like a coach's notebook, not a
          dashboard. It refuses the metric-tile grid every fitness app ships and
          leads with the one thing the runner came to check.
          OWN-WORLD: "Tartan" — warm clay ground, chalk-white surfaces, a single
          ember accent for action and selection, measurements set in mono on a
          lane-marked baseline. Figtree throughout, one weight step per role.
          STORY: the runner opens the app, sees where the week stands against
          the race that matters, and either logs, adjusts, or closes it.
          FIRST VIEWPORT: race countdown and week-to-date at the top of Today,
          load state beneath it, the primary action in the app bar.
          FORM: mobile-first single column, 4-tab bar, profile in the app bar.
        */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider>{children}</I18nProvider>
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
        <AuthListener />
        <ServiceWorkerRegistration />
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
