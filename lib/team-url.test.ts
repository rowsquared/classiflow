import { describe, expect, it } from 'vitest'
import { createLoader } from 'nuqs/server'
import { NO_FILTERS, type TeamFilters } from './team-table'
import { sortFromUrl, sortToUrl, teamFiltersFromUrl, teamFiltersToUrl, teamParsers } from './team-url'

const load = createLoader(teamParsers)

describe('team URL state', () => {
  it('an empty URL is the default view: active members, default order', () => {
    const state = load(new URLSearchParams())
    expect(teamFiltersFromUrl(state)).toEqual(NO_FILTERS)
    expect(sortFromUrl(state.sort)).toBeNull()
  })

  it('round-trips filters, with "Everyone" as status=all', () => {
    const filters: TeamFilters = {
      search: 'nova',
      role: 'labeller',
      supervisorId: 'u1',
      status: '',
      activity: 'never'
    }
    const url = teamFiltersToUrl(filters)
    expect(url.status).toBe('all')
    expect(teamFiltersFromUrl({ ...url, sort: null })).toEqual(filters)
  })

  it('reads and writes the sort as key.direction and ignores unknown values', () => {
    expect(sortFromUrl(load(new URLSearchParams('sort=lastSeenAt.desc')).sort)).toEqual({
      key: 'lastSeenAt',
      direction: 'desc'
    })
    expect(sortToUrl({ key: 'role', direction: 'asc' })).toBe('role.asc')
    expect(load(new URLSearchParams('sort=password.asc&role=owner')).sort).toBeNull()
    expect(load(new URLSearchParams('role=owner')).role).toBeNull()
  })
})
