import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/server/page-user'
import AccountsClient from '@/app/accounts/AccountsClient'

export default async function TeamPage() {
  const user = await requirePageSession()
  if (user.platformRole !== 'admin') redirect('/')
  return <AccountsClient key={user.id} currentUserId={user.id} />
}
