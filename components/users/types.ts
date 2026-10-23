export type Workspace = { id: string; name: string; status: 'active' | 'archived' }
export type Membership = {
  id: string
  role: 'admin' | 'supervisor' | 'labeller'
  status: string
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
  workspace: Workspace
  supervisor: { user: { id: string; name: string } } | null
  _count: { reports: number }
}
export type DirectoryUser = {
  id: string
  username: string
  name: string
  email: string
  role: 'admin' | 'user'
  banned: boolean | null
  lastLogin: string | null
  mustResetPassword: boolean
  invitedAt: string | null
  invitationAcceptedAt: string | null
  memberships: Membership[]
  assigned?: number | null
}
export type DirectoryPage = {
  users: DirectoryUser[]
  total: number
  totalAvailable: number
  page: number
  pageSize: number
}
export const controlClass =
  'w-full border border-gray-500 px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600'
