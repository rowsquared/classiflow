import { describe, expect, it } from 'vitest'
import { memberExportCsv } from './member-export'
import { MEMBER_IMPORT_COLUMNS } from './member-import'

const row = {
  username: 'ana',
  email: 'ana@example.org',
  name: '=HYPERLINK("x")',
  role: 'labeller',
  supervisorUsername: 'sam',
  status: 'active',
  invitationPending: false,
  mustResetPassword: true,
  addedAt: new Date('2026-10-01T08:00:00Z'),
  lastSeenAt: null,
  lastLogin: new Date('2026-10-02T09:30:00Z'),
  openAssignments: 12
}

describe('member export CSV', () => {
  it('starts with the member import columns', () => {
    const header = memberExportCsv([]).split('\n')[0]!.replace(/"/g, '').split(',')
    expect(header.slice(0, 5)).toEqual(MEMBER_IMPORT_COLUMNS.slice(0, 5))
  })

  it('writes one quoted line per member and neutralises formulas in free text', () => {
    const [, line] = memberExportCsv([row]).split('\n')
    expect(line).toBe(
      '"ana","ana@example.org","\'=HYPERLINK(""x"")","labeller","sam","active","false","true",' +
        '"2026-10-01T08:00:00.000Z","","2026-10-02T09:30:00.000Z","12"'
    )
  })
})
