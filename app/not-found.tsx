import Link from 'next/link'
import { buttonClass } from '@/components/ui/styles'

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100dvh-66px)] items-center justify-center p-6">
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-gray-600">Check the address or return to classiflow.</p>
        <Link href="/" className={buttonClass('primary')}>
          Go to home
        </Link>
      </div>
    </div>
  )
}
