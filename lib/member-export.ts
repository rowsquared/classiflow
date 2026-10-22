import { toCsv, type CsvColumn } from '@/lib/csv'

// The Team page's "Export members" CSV. The first five columns are the member
// import's (lib/member-import.ts), so a cleaned-up export can seed another
// workspace; the rest describe the member here. No password, link or mail
// content is ever exported.

export type MemberExportRow = {
  username: string
  email: string
  name: string
  role: string
  supervisorUsername: string | null
  status: string
  invitationPending: boolean
  mustResetPassword: boolean
  addedAt: Date
  lastSeenAt: Date | null
  lastLogin: Date | null
  openAssignments: number
}

const COLUMNS: CsvColumn[] = [
  { header: 'username', text: true },
  { header: 'email', text: true },
  { header: 'name', text: true },
  { header: 'role' },
  { header: 'supervisor', text: true },
  { header: 'status' },
  { header: 'invitation_pending' },
  { header: 'must_change_password' },
  { header: 'added_at' },
  { header: 'last_seen_at' },
  { header: 'last_login_at' },
  { header: 'open_assignments' }
]

const iso = (date: Date | null) => date?.toISOString() ?? ''

export function memberExportCsv(rows: MemberExportRow[]): string {
  return toCsv(
    COLUMNS,
    rows.map(r => [
      r.username,
      r.email,
      r.name,
      r.role,
      r.supervisorUsername ?? '',
      r.status,
      r.invitationPending,
      r.mustResetPassword,
      iso(r.addedAt),
      iso(r.lastSeenAt),
      iso(r.lastLogin),
      r.openAssignments
    ]),
    { neutralizeFormulas: true }
  )
}
