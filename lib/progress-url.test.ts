import { describe, expect, it } from 'vitest'
import {
  activityParams,
  effectiveGranularity,
  loadProgressUrlState,
  overviewParams,
  peopleParams,
  rangeDays,
  scopeKey
} from './progress-url'

const load = (search: string) => loadProgressUrlState(new URLSearchParams(search))

describe('progress URL state', () => {
  it('defaults to the last seven days, daily, people by name', () => {
    const state = load('')
    expect(overviewParams(state)).toBe('days=7')
    expect(activityParams(state)).toBe('days=7&granularity=day')
    expect(peopleParams(state)).toBe('days=7&sort=name&dir=asc&page=1')
  })

  it('sends a custom range instead of the preset when both dates are set', () => {
    const state = load('days=30&startDate=2026-10-01&endDate=2026-10-07&teamId=u1&personId=u2')
    expect(overviewParams(state)).toBe('startDate=2026-10-01&endDate=2026-10-07&teamId=u1&personId=u2')
    expect(rangeDays(state)).toBe(7)
    // One date alone is not a custom range.
    expect(overviewParams(load('days=30&startDate=2026-10-01'))).toBe('days=30')
  })

  it('shows long ranges by week', () => {
    expect(effectiveGranularity(load('days=365'))).toBe('day')
    expect(effectiveGranularity(load('startDate=2025-01-01&endDate=2026-01-02'))).toBe('week')
    expect(activityParams(load('startDate=2025-01-01&endDate=2026-01-02'))).toContain('granularity=week')
  })

  it('passes search, sort and page to the people report only', () => {
    const state = load('q=%20ann%20&sort=labeled&dir=desc&page=3')
    expect(peopleParams(state)).toBe('days=7&q=ann&sort=labeled&dir=desc&page=3')
    expect(overviewParams(state)).toBe('days=7')
  })

  it('ignores unknown values', () => {
    const state = load('sort=password&dir=sideways&granularity=hour')
    expect(state).toMatchObject({ sort: 'name', dir: 'asc', granularity: 'day' })
  })

  it('identifies the scope by team and person', () => {
    expect(scopeKey(load('teamId=a'))).not.toBe(scopeKey(load('personId=a')))
    expect(scopeKey(load('teamId=a&days=30'))).toBe(scopeKey(load('teamId=a')))
  })
})
