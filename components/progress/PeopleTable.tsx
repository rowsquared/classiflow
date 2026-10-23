import type { PeopleSort, ProgressPeople } from '@/lib/contracts/progress'
import { formatNumber, relativeTime } from './format'
import { buttonClass } from '@/components/ui/styles'
import { userDisplayName } from '@/lib/user-display'

type Column = { sort: PeopleSort; label: string; numeric?: boolean }

const COLUMNS: Column[] = [
  { sort: 'name', label: 'Person' },
  { sort: 'role', label: 'Role' },
  { sort: 'assigned', label: 'Assigned now', numeric: true },
  { sort: 'complete', label: 'Complete now', numeric: true },
  { sort: 'remaining', label: 'Remaining now', numeric: true },
  { sort: 'labeled', label: 'Labeled in period', numeric: true },
  { sort: 'lastSeen', label: 'Last seen' }
]

const ROLE_LABEL = { admin: 'Admin', supervisor: 'Supervisor', labeller: 'Labeller' } as const

type PeopleTableProps = {
  people: ProgressPeople
  sort: PeopleSort
  dir: 'asc' | 'desc'
  onSort: (sort: PeopleSort) => void
  onSelectPerson: (userId: string) => void
  onPage: (page: number) => void
  /** Reference time for "last seen", fixed per render pass. */
  now: number
}

/**
 * One page of people: workload by current assignment, activity by the person
 * as author. Rows overlap (shared assignments, several people labeling one
 * record), so they need not add up to the overview cards.
 */
export default function PeopleTable({ people, sort, dir, onSort, onSelectPerson, onPage, now }: PeopleTableProps) {
  const pages = Math.max(1, Math.ceil(people.total / people.pageSize))
  const first = people.total === 0 ? 0 : (people.page - 1) * people.pageSize + 1
  const last = Math.min(people.page * people.pageSize, people.total)

  return (
    <div className="border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm" data-testid="people-table">
          <caption className="sr-only">
            People, sorted by {COLUMNS.find(c => c.sort === sort)?.label} {dir === 'asc' ? 'ascending' : 'descending'}
          </caption>
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              {COLUMNS.map(column => {
                const active = column.sort === sort
                return (
                  <th
                    key={column.sort}
                    scope="col"
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`px-4 py-2 font-medium ${column.numeric ? 'text-right' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(column.sort)}
                      className="inline-flex items-center gap-1 rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {column.label}
                      <span aria-hidden="true" className="text-xs text-gray-500">
                        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {people.people.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-gray-600">
                  Nobody matches this view.
                </td>
              </tr>
            ) : (
              people.people.map(person => (
                <tr key={person.userId} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    {person.platformOnly ? (
                      <span className="font-medium text-gray-900">{userDisplayName(person)}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectPerson(person.userId)}
                        className="text-left font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                        title={`Show ${userDisplayName(person)} only`}
                      >
                        {userDisplayName(person)}
                      </button>
                    )}
                    {person.platformOnly && (
                      <span
                        className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                        title="Labeled here as a platform administrator, without a membership"
                      >
                        Platform admin
                      </span>
                    )}
                    {person.status === 'suspended' && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{ROLE_LABEL[person.role]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(person.assigned)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(person.complete)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(person.remaining)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(person.labeledRecords)}</td>
                  <td className="px-4 py-2 text-gray-700" title={person.lastSeenAt ?? undefined}>
                    {relativeTime(person.lastSeenAt, now)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav
        aria-label="People pages"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 text-sm text-gray-700"
      >
        <span>
          {people.total === 0
            ? 'No people'
            : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(people.total)} people`}
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPage(people.page - 1)}
            disabled={people.page <= 1}
            className={buttonClass('secondary', 'sm')}
          >
            Previous
          </button>
          <span>
            Page {people.page} of {pages}
          </span>
          <button
            type="button"
            onClick={() => onPage(people.page + 1)}
            disabled={people.page >= pages}
            className={buttonClass('secondary', 'sm')}
          >
            Next
          </button>
        </span>
      </nav>
    </div>
  )
}
