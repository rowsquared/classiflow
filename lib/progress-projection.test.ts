import { describe, expect, it } from 'vitest'
import { projectCompletion } from './progress-projection'

const base = {
  remaining: 20,
  completedInPeriod: 14,
  startDate: '2026-10-16',
  endDate: '2026-10-22',
  timeZone: 'UTC',
  now: new Date('2026-10-22T12:00:00.000Z')
}

describe('projectCompletion', () => {
  it('projects from completed records per selected day and current remaining workload', () => {
    expect(projectCompletion(base)).toMatchObject({
      status: 'projected',
      date: '2026-11-01',
      daysInPeriod: 7,
      completedPerDay: 2
    })
  })

  it('uses the full selected window, including days before activity tracking began', () => {
    expect(projectCompletion({ ...base, startDate: '2026-07-25' })).toMatchObject({
      status: 'projected',
      daysInPeriod: 90,
      completedPerDay: 14 / 90,
      date: '2027-02-28'
    })
  })

  it('does not invent a date when activity is absent', () => {
    expect(projectCompletion({ ...base, completedInPeriod: 0 })).toMatchObject({ status: 'no-pace', date: null })
  })

  it('handles completed workloads and excludes future days from the pace', () => {
    expect(projectCompletion({ ...base, endDate: '2026-10-29' }).daysInPeriod).toBe(7)
    expect(projectCompletion({ ...base, remaining: 0 })).toMatchObject({ status: 'complete', date: '2026-10-22' })
  })
})
