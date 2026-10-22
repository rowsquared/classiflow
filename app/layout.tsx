import '../styles/globals.css'
import type { ReactNode } from 'react'
import Script from 'next/script'
import { headers } from 'next/headers'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
})

export const metadata = {
  title: 'classiflow – labeling tool',
  description: 'complex classifications made easy',
  icons: {
    icon: [
      // ICO format for maximum compatibility (browsers will use this first)
      { url: '/favicon.ico', sizes: 'any' },
      // PNG formats for better browser support
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      // SVG for modern browsers that support it
      { url: '/favicon.svg', type: 'image/svg+xml' }
    ]
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Per-request CSP nonce from proxy.ts. Reading headers also renders every
  // page per request, which a nonce-based policy needs.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans bg-gray-50 text-gray-900 antialiased overflow-hidden`}>
        <Script
          id="sidebar-state-init"
          nonce={nonce}
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem('sidebar-collapsed');
                  if (saved !== null) {
                    const isCollapsed = JSON.parse(saved);
                    document.documentElement.setAttribute('data-sidebar-collapsed', isCollapsed);
                  }
                } catch (e) {}
              })();
            `
          }}
        />
        {/* Workspace pages add the sidebar (app/w/[workspaceId]/layout.tsx). */}
        {children}
      </body>
    </html>
  )
}
