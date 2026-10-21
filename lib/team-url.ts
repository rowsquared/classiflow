import { parseAsString, parseAsStringLiteral, type inferParserType } from 'nuqs/server'
import type { Sort, SortKey, TeamFilters } from '@/lib/team-table'

// The Team page's view (search, filters, sort) lives in the URL (nuqs), so a
// reload, back/forward or a shared link shows the same members. The list is
// filtered in the browser (lib/team-table.ts); the server page does not read
// these. `status=all` is "Everyone"; without it the page shows active members.

const SORT_KEYS = [
  'username',
  'name',
  'email',
  'role',
  'supervisor',
  'team',
  'assignments',
  'lastSeenAt',
  'lastLogin'
] as const satisfies readonly SortKey[]

const SORTS = SORT_KEYS.flatMap(key => [`${key}.asc`, `${key}.desc`] as const)

export const teamParsers = {
  q: parseAsString.withDefault(''),
  role: parseAsStringLiteral(['admin', 'supervisor', 'labeller'] as const),
  supervisor: parseAsString,
  status: parseAsStringLiteral(['active', 'removed', 'must-reset', 'invited', 'all'] as const).withDefault('active'),
  activity: parseAsStringLiteral(['seen-7', 'not-seen-7', 'not-seen-30', 'never'] as const),
  sort: parseAsStringLiteral(SORTS)
}

export type TeamUrlState = inferParserType<typeof teamParsers>

export function teamFiltersFromUrl(state: TeamUrlState): TeamFilters {
  return {
    search: state.q,
    role: state.role ?? '',
    supervisorId: state.supervisor ?? '',
    status: state.status === 'all' ? '' : state.status,
    activity: state.activity ?? ''
  }
}

/** The URL values for a set of filters (null removes a parameter). */
export function teamFiltersToUrl(filters: TeamFilters): Omit<TeamUrlState, 'sort'> {
  return {
    q: filters.search,
    role: filters.role || null,
    supervisor: filters.supervisorId || null,
    status: filters.status || 'all',
    activity: filters.activity || null
  }
}

export function sortFromUrl(value: TeamUrlState['sort']): Sort {
  if (!value) return null
  const [key, direction] = value.split('.') as [SortKey, 'asc' | 'desc']
  return { key, direction }
}

export function sortToUrl(sort: Sort): TeamUrlState['sort'] {
  return sort ? `${sort.key}.${sort.direction}` : null
}
