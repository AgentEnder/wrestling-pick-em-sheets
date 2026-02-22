import type { Metadata, Viewport } from 'next'
import { Inter, Oswald } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import './globals.css'

const _inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const _oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-oswald',
})

export const metadata: Metadata = {
  title: 'Pick Em Sheet Generator',
  description: 'Create printable pick em sheets for pro wrestling events',
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
  themeColor: '#1a1a2e',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${_inter.variable} ${_oswald.variable} font-sans antialiased`}>
          {children}
          <Toaster theme="dark" richColors />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  )
}
