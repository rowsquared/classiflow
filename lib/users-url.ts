import { createLoader, parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const usersParsers = {
  q: parseAsString.withDefault(''),
  workspace: parseAsString.withDefault(''),
  role: parseAsStringLiteral(['admin', 'supervisor', 'labeller'] as const),
  state: parseAsStringLiteral(['active', 'disabled'] as const),
  access: parseAsStringLiteral(['active', 'removed', 'all'] as const).withDefault('active'),
  setup: parseAsStringLiteral(['password', 'invited'] as const),
  supervisor: parseAsString,
  activity: parseAsStringLiteral(['seen-7', 'not-seen-7', 'not-seen-30', 'never'] as const),
  sort: parseAsStringLiteral([
    'name',
    'email',
    'role',
    'supervisor',
    'team',
    'assigned',
    'lastSeen',
    'lastLogin'
  ] as const).withDefault('name'),
  direction: parseAsStringLiteral(['asc', 'desc'] as const).withDefault('asc'),
  page: parseAsInteger.withDefault(1)
}
export const loadUsersSearchParams = createLoader(usersParsers)
