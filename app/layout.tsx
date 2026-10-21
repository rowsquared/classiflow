import '../styles/globals.css'
import type { ReactNode } from 'react'
import Script from 'next/script'
import Sidebar from '@/components/Sidebar'
import SessionProvider from '@/components/SessionProvider'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata = {
  title: 'classiflow - Labeling Tool',
  description: 'Modern annotation tool for hierarchical taxonomies',
  icons: {
    icon: [
      // ICO format for maximum compatibility (browsers will use this first)
      { url: '/favicon.ico', sizes: 'any' },
      // PNG formats for better browser support
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      // SVG for modern browsers that support it
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans bg-gray-50 text-gray-900 antialiased overflow-hidden`}>
        <Script
          id="sidebar-state-init"
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
            `,
          }}
        />
        <SessionProvider>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-white">
              {children}
            </main>
          </div>
        </SessionProvider>
      </body>
    </html>
  )
}


