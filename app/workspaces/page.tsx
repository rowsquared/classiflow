import Link from 'next/link'
import { requirePageSession } from '@/lib/server/page-user'
import { listAccessibleWorkspaces } from '@/lib/server/workspaces'
import CreateWorkspaceForm from './CreateWorkspaceForm'

// The workspace chooser: only workspaces the user may enter are listed.
// Platform admins can create workspaces here.
export default async function WorkspacesPage() {
  const user = await requirePageSession()
  const workspaces = await listAccessibleWorkspaces(user)

  return (
    <div className="min-h-screen bg-gray-50 overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-semibold text-gray-900">Workspaces</h1>
          {user.platformRole === 'admin' && (
            <Link href="/accounts" className="text-sm text-indigo-600 hover:text-indigo-700">
              Manage accounts
            </Link>
          )}
        </div>
        <p className="text-sm text-gray-600 mb-8">
          Each workspace is a separate classification exercise with its own records, taxonomies, members and roles.
        </p>

        {workspaces.length === 0 ? (
          <div className="p-6 rounded-lg bg-white border border-gray-200 text-sm text-gray-700">
            You are not a member of any workspace yet. Ask a workspace administrator to add you.
          </div>
        ) : (
          <ul className="space-y-3">
            {workspaces.map(w => (
              <li key={w.id}>
                <Link
                  href={`/w/${w.id}/queue`}
                  className="block p-5 rounded-lg bg-white border border-gray-200 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-gray-900">{w.name}</span>
                    <span className="text-xs text-gray-600">
                      {w.role}
                      {w.authority === 'platform' ? ' (platform admin)' : ''}
                      {w.status === 'archived' ? ' · archived' : ''}
                    </span>
                  </div>
                  {w.description && <p className="mt-1 text-sm text-gray-600">{w.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {user.platformRole === 'admin' && <CreateWorkspaceForm />}
      </div>
    </div>
  )
}
