import { describe, expect, it } from 'vitest'
import {
  countActiveFilters,
  EMPTY_QUEUE_FILTERS,
  loadQueueUrlState,
  pickQueueFilters,
  queueListParams,
  queueStatsParams
} from './queue-url'

const state = (search: string) => loadQueueUrlState(new URLSearchParams(search))

describe('queue URL state', () => {
  it('defaults to the pending tab, page 1, 100 per page', () => {
    expect(state('')).toMatchObject({ q: '', tab: 'pending', page: 1, limit: 100, status: [] })
    expect(queueListParams(state(''))).toBe('status=pending&page=1&limit=100&sort=createdAt&order=asc')
    expect(queueStatsParams(state(''))).toBe('')
  })

  it('ignores an unknown tab instead of failing', () => {
    expect(state('tab=bogus').tab).toBe('pending')
  })

  it('uses the tab as the status, and the filter statuses only on the All tab', () => {
    expect(queueListParams(state('tab=submitted&status=skipped'))).toContain('status=submitted&')
    expect(queueListParams(state('tab=all&status=skipped,pending'))).toContain('status=skipped%2Cpending')
    expect(queueListParams(state('tab=all'))).not.toContain('status=')
    // The tab counts always cover every status of the filtered set.
    expect(queueStatsParams(state('tab=submitted&status=skipped'))).toBe('status=skipped')
  })

  it('passes filters on under the names the API parses, codes as strings', () => {
    const s = state('q=nurse&taxonomyKey=ISCO&code=011&flagged=true&hasSubmittedLabels=false&page=3&limit=20')
    const list = new URLSearchParams(queueListParams(s))
    expect(Object.fromEntries(list)).toMatchObject({
      q: 'nurse',
      taxonomyKey: 'ISCO',
      code: '011',
      flagged: 'true',
      hasSubmittedLabels: 'false',
      page: '3',
      limit: '20'
    })
    const stats = new URLSearchParams(queueStatsParams(s))
    expect(stats.get('code')).toBe('011')
    expect(stats.has('page')).toBe(false)
  })

  it('is deterministic, so it can be part of a query key', () => {
    expect(queueListParams(state('flagged=true&q=a'))).toBe(queueListParams(state('q=a&flagged=true')))
  })

  it('counts filter groups, not parameters', () => {
    expect(countActiveFilters(EMPTY_QUEUE_FILTERS)).toBe(0)
    const f = pickQueueFilters(state('lastEditedFrom=2026-01-01&lastEditedTo=2026-02-01&flagged=false&status=pending'))
    expect(countActiveFilters(f)).toBe(3)
  })

  it('picks only the filter values', () => {
    expect(Object.keys(pickQueueFilters(state('q=x&page=2')))).toEqual(Object.keys(EMPTY_QUEUE_FILTERS))
  })
})
