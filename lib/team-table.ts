/**
 * Filtering and sorting for the Team page (members of one workspace). The list
 * is small and loaded whole, so this runs in the browser. Pure functions, unit
 * tested in team-table.test.ts.
 */

export type MemberRole = 'admin' | 'supervisor' | 'labeller'

export type TeamMember = {
  id: string
  username: string
  email: string
  name: string | null
  role: MemberRole
  status: 'active' | 'suspended'
  supervisorId: string | null
  supervisor: { id: string; name: string | null; email: string } | null
  labellers: { id: string; name: string | null; email: string }[]
  mustResetPassword: boolean
  lastLogin: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
  /** Who added them to this workspace. */
  addedBy: string | null
  accountCreatedAt: string
  /** Created with an invitation link and no password chosen yet. */
  invitationPending: boolean
  /** The latest mail sent to them from this workspace. */
  lastMail: { purpose: string; status: string; createdAt: string } | null
  _count: { assignedSentences: number }
}

export type StatusFilter = '' | 'active' | 'removed' | 'must-reset' | 'invited'
export type ActivityFilter = '' | 'seen-7' | 'not-seen-7' | 'not-seen-30' | 'never'

export type TeamFilters = {
  search: string
  role: '' | MemberRole
  supervisorId: string
  status: StatusFilter
  activity: ActivityFilter
}

export const NO_FILTERS: TeamFilters = { search: '', role: '', supervisorId: '', status: 'active', activity: '' }

const DAY = 24 * 60 * 60 * 1000

export function filterMembers(members: TeamMember[], filters: TeamFilters, now = Date.now()): TeamMember[] {
  const query = filters.search.trim().toLowerCase()
  return members.filter(m => {
    if (query && ![m.username, m.name ?? '', m.email].some(v => v.toLowerCase().includes(query))) return false
    if (filters.role && m.role !== filters.role) return false
    if (filters.supervisorId && m.supervisorId !== filters.supervisorId) return false
    if (filters.status === 'active' && m.status !== 'active') return false
    if (filters.status === 'removed' && m.status !== 'suspended') return false
    if (filters.status === 'must-reset' && !m.mustResetPassword) return false
    if (filters.status === 'invited' && !m.invitationPending) return false
    const seen = m.lastSeenAt ? now - new Date(m.lastSeenAt).getTime() : null
    if (filters.activity === 'seen-7' && (seen === null || seen > 7 * DAY)) return false
    if (filters.activity === 'not-seen-7' && seen !== null && seen <= 7 * DAY) return false
    if (filters.activity === 'not-seen-30' && seen !== null && seen <= 30 * DAY) return false
    if (filters.activity === 'never' && seen !== null) return false
    return true
  })
}

export type SortKey =
  'username' | 'name' | 'email' | 'role' | 'supervisor' | 'team' | 'assignments' | 'lastSeenAt' | 'lastLogin'
export type Sort = { key: SortKey; direction: 'asc' | 'desc' } | null

const ROLE_RANK: Record<MemberRole, number> = { admin: 0, supervisor: 1, labeller: 2 }

function sortValue(m: TeamMember, key: SortKey): string | number | null {
  switch (key) {
    case 'username':
      return m.username
    case 'name':
      return m.name?.toLowerCase() || null
    case 'email':
      return m.email
    case 'role':
      return ROLE_RANK[m.role]
    case 'supervisor':
      return m.supervisor ? (m.supervisor.name || m.supervisor.email).toLowerCase() : null
    case 'team':
      return m.labellers.length
    case 'assignments':
      return m._count.assignedSentences
    case 'lastSeenAt':
      return m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : null
    case 'lastLogin':
      return m.lastLogin ? new Date(m.lastLogin).getTime() : null
  }
}

/**
 * Sorted copy. Empty values ("Never", no supervisor) go last in both
 * directions, so they never bury the active people; username breaks ties;
 * roles sort by privilege (admin, supervisor, labeller), not alphabetically.
 */
export function sortMembers(members: TeamMember[], sort: Sort): TeamMember[] {
  const byUsername = (a: TeamMember, b: TeamMember) => a.username.localeCompare(b.username)
  if (!sort) return [...members].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || byUsername(a, b))
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...members].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va === null && vb === null) return byUsername(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    const order = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return order * factor || byUsername(a, b)
  })
}

/** Header clicks cycle ascending → descending → default order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (!current || current.key !== key) return { key, direction: 'asc' }
  if (current.direction === 'asc') return { key, direction: 'desc' }
  return null
}

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** An 18-character temporary password from an unambiguous alphabet (no 0/O, 1/l/I). */
export function generatePassword(
  random: (n: number) => Uint32Array = n => crypto.getRandomValues(new Uint32Array(n))
): string {
  return Array.from(random(18), v => PASSWORD_ALPHABET[v % PASSWORD_ALPHABET.length]).join('')
}
