import { notFound } from 'next/navigation'
import { mailEnabled } from '@/lib/mail/config'
import ForgotPasswordClient from './ForgotPasswordClient'

// Signed out (proxy.ts). Without mail there is no self-service recovery: an
// admin sets a temporary password instead.
export default function ForgotPasswordPage() {
  if (!mailEnabled()) notFound()
  return <ForgotPasswordClient />
}
