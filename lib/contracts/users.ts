import { z } from 'zod'

// Query parameters of GET /api/users (the platform admins' global user
// directory), shared by the handler and the /team page's URL state.

export const USER_ROLE_FILTERS = ['platform_admin', 'admin', 'supervisor', 'labeller'] as const
export const USER_STATE_FILTERS = ['active', 'disabled', 'must_reset'] as const
export const USERS_PAGE_SIZE = 50

export const globalUsersQuery = z.object({
  /** Name, email or username (contains, case-insensitive). */
  q: z.string().trim().max(200).default(''),
  /** A workspace id, or `none` for people without active workspace access. */
  workspace: z.string().trim().max(100).default(''),
  /** `platform_admin`, or an active workspace role (in `workspace` when given). */
  role: z.enum(USER_ROLE_FILTERS).optional(),
  state: z.enum(USER_STATE_FILTERS).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(USERS_PAGE_SIZE)
})

export type GlobalUsersQuery = z.output<typeof globalUsersQuery>

export const directoryQuery = globalUsersQuery.extend({
  role: z.enum(['admin', 'supervisor', 'labeller']).optional(),
  access: z.enum(['active', 'removed', 'all']).default('active'),
  setup: z.enum(['password', 'invited']).optional(),
  supervisor: z.string().max(100).optional(),
  activity: z.enum(['seen-7', 'not-seen-7', 'not-seen-30', 'never']).optional(),
  sort: z.enum(['name', 'email', 'role', 'supervisor', 'team', 'assigned', 'lastSeen', 'lastLogin']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc')
})
export type DirectoryQuery = z.output<typeof directoryQuery>
