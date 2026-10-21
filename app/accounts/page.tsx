import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/server/page-user'
import AccountsClient from './AccountsClient'

// Platform administration of global accounts (sign-in identity, platform
// role, temporary password, ban). Workspace roles are set on each
// workspace's Team page.
export default async function AccountsPage() {
  const user = await requirePageSession()
  if (user.platformRole !== 'admin') redirect('/')
  return <AccountsClient currentUserId={user.id} />
}
