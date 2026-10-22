import { describe, expect, it } from 'vitest'
import { projectCompletion } from './progress-projection'

const base = {
  remaining: 20,
  completedInPeriod: 14,
  importedInPeriod: 7,
  startDate: '2026-10-16',
  endDate: '2026-10-22',
  activityCoverageStart: '2026-10-01T00:00:00.000Z',
  timeZone: 'UTC',
  now: new Date('2026-10-22T12:00:00.000Z')
}

describe('projectCompletion', () => {
  it('projects from net daily pace and current remaining workload', () => {
    expect(projectCompletion(base)).toMatchObject({
      status: 'projected',
      date: '2026-11-11',
      daysObserved: 7,
      completedPerDay: 2,
      importedPerDay: 1,
      netPerDay: 1
    })
  })

  it('does not invent a date when intake matches completion or activity is absent', () => {
    expect(projectCompletion({ ...base, importedInPeriod: 14 })).toMatchObject({
      status: 'no-net-progress',
      date: null
    })
    expect(projectCompletion({ ...base, completedInPeriod: 0 })).toMatchObject({ status: 'no-pace', date: null })
  })

  it('uses only days with activity coverage and handles completed workloads', () => {
    expect(projectCompletion({ ...base, activityCoverageStart: '2026-10-21T08:00:00.000Z' }).daysObserved).toBe(2)
    expect(projectCompletion({ ...base, remaining: 0 })).toMatchObject({ status: 'complete', date: '2026-10-22' })
  })
})
