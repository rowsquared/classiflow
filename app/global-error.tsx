'use client'

import '../styles/globals.css'
import ErrorPage from './error'

export default function GlobalError(props: Parameters<typeof ErrorPage>[0]) {
  return (
    <html lang="en">
      <body className="bg-gray-50 font-sans text-gray-900">
        <main>
          <ErrorPage {...props} />
        </main>
      </body>
    </html>
  )
}
