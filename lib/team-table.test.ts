import { describe, expect, it } from 'vitest'
import { filterMembers, generatePassword, nextSort, NO_FILTERS, sortMembers, type TeamMember } from './team-table'
import { passwordProblem } from './password-policy'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function member(username: string, over: Partial<TeamMember> = {}): TeamMember {
  return {
    id: username,
    username,
    email: `${username}@x.org`,
    name: username.toUpperCase(),
    role: 'labeller',
    status: 'active',
    supervisorId: null,
    supervisor: null,
    labellers: [],
    mustResetPassword: false,
    lastLogin: null,
    lastSeenAt: null,
    createdAt: daysAgo(100),
    updatedAt: daysAgo(100),
    addedBy: null,
    accountCreatedAt: daysAgo(100),
    invitationPending: false,
    lastMail: null,
    _count: { assignedSentences: 0 },
    ...over
  }
}

const members = [
  member('carla', { role: 'admin', lastSeenAt: daysAgo(1) }),
  member('ben', { role: 'supervisor', lastSeenAt: daysAgo(10), labellers: [{ id: 'dora', name: null, email: 'd' }] }),
  member('dora', { supervisorId: 'ben', lastSeenAt: null, mustResetPassword: true }),
  member('anna', { status: 'suspended', lastSeenAt: daysAgo(40) })
]

describe('filterMembers', () => {
  it('finds members whose invitation is still open', () => {
    const invited = [...members, member('emil', { invitationPending: true })]
    expect(filterMembers(invited, { ...NO_FILTERS, status: 'invited' }, NOW).map(m => m.username)).toEqual(['emil'])
  })

  it('shows active members by default and finds by username, name or email', () => {
    expect(filterMembers(members, NO_FILTERS, NOW).map(m => m.username)).toEqual(['carla', 'ben', 'dora'])
    expect(filterMembers(members, { ...NO_FILTERS, search: 'DOR' }, NOW).map(m => m.username)).toEqual(['dora'])
  })

  it('filters by role, supervisor, status and activity', () => {
    expect(filterMembers(members, { ...NO_FILTERS, role: 'supervisor' }, NOW).map(m => m.username)).toEqual(['ben'])
    expect(filterMembers(members, { ...NO_FILTERS, supervisorId: 'ben' }, NOW).map(m => m.username)).toEqual(['dora'])
    expect(filterMembers(members, { ...NO_FILTERS, status: 'removed' }, NOW).map(m => m.username)).toEqual(['anna'])
    expect(filterMembers(members, { ...NO_FILTERS, status: 'must-reset' }, NOW).map(m => m.username)).toEqual(['dora'])
    expect(filterMembers(members, { ...NO_FILTERS, activity: 'seen-7' }, NOW).map(m => m.username)).toEqual(['carla'])
    expect(filterMembers(members, { ...NO_FILTERS, activity: 'not-seen-7' }, NOW).map(m => m.username)).toEqual([
      'ben',
      'dora'
    ])
    expect(filterMembers(members, { ...NO_FILTERS, activity: 'never' }, NOW).map(m => m.username)).toEqual(['dora'])
  })
})

describe('sortMembers', () => {
  it('defaults to role by privilege, then username', () => {
    expect(sortMembers(members, null).map(m => m.username)).toEqual(['carla', 'ben', 'anna', 'dora'])
  })

  it('keeps empty values last in both directions', () => {
    const asc = sortMembers(members, { key: 'lastSeenAt', direction: 'asc' }).map(m => m.username)
    const desc = sortMembers(members, { key: 'lastSeenAt', direction: 'desc' }).map(m => m.username)
    expect(asc).toEqual(['anna', 'ben', 'carla', 'dora'])
    expect(desc).toEqual(['carla', 'ben', 'anna', 'dora'])
  })

  it('cycles ascending, descending, default', () => {
    const first = nextSort(null, 'name')
    expect(first).toEqual({ key: 'name', direction: 'asc' })
    expect(nextSort(first, 'name')).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort(nextSort(first, 'name'), 'name')).toBeNull()
    expect(nextSort(first, 'email')).toEqual({ key: 'email', direction: 'asc' })
  })
})

describe('generatePassword', () => {
  it('makes 18 unambiguous characters that pass the password policy', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{18}$/)
    expect(passwordProblem(password, { username: 'maria' })).toBeNull()
  })
})
