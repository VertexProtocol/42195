import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
// import { Toaster } from '@/components/ui/sonner' // Temporarily disabled
import { I18nProvider } from '@/lib/i18n'
import { ServiceWorkerRegistration } from '@/components/sw-register'
import './globals.css'

export const metadata: Metadata = {
  title: '42195 - Training Tracker',
  description: 'Track your running training progress toward your next goal',
  generator: 'v0.app',
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
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f5f3ef",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider>
            {children}
          </I18nProvider>
          {/* <Toaster position="top-center" richColors closeButton /> */}
        </ThemeProvider>
        <ServiceWorkerRegistration />
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
