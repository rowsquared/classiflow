'use client'

import { useState, type FormEvent } from 'react'
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox'
import { RANGE_PRESETS, isCustomRange, type ProgressUrlState } from '@/lib/progress-url'
import { MAX_RANGE_DAYS, daysBetween, parseCalendarDate } from '@/lib/reporting-dates'

export type PickerMember = {
  id: string
  name: string
  username: string
  role: 'admin' | 'supervisor' | 'labeller'
  status: 'active' | 'suspended'
  supervisorId: string | null
}

/** The member and everyone below them in the supervisor tree (user ids). */
export function subtreeOf(members: PickerMember[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let added = true
  while (added) {
    added = false
    for (const m of members) {
      if (m.supervisorId && ids.has(m.supervisorId) && !ids.has(m.id)) {
        ids.add(m.id)
        added = true
      }
    }
  }
  return ids
}

const ROLE_HINT = { admin: 'admin', supervisor: 'supervisor', labeller: 'labeller' } as const
const option = (m: PickerMember): ComboboxOption => ({
  value: m.id,
  label: m.name || m.username,
  hint: m.status === 'suspended' ? `${ROLE_HINT[m.role]}, inactive` : ROLE_HINT[m.role]
})

const PRESET_LABEL: Record<(typeof RANGE_PRESETS)[number], string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
  365: 'Last 12 months'
}

type ProgressFiltersProps = {
  state: ProgressUrlState
  /** The applied range (inclusive dates) as the server resolved it, once known. */
  range: { startDate: string; endDate: string } | null
  members: PickerMember[]
  /** Labellers report on themselves only: no team or person pickers. */
  showPickers: boolean
  onChange: (patch: Partial<ProgressUrlState>) => void
}

/** Date range (presets or custom with Apply), team and person. */
export default function ProgressFilters({ state, range, members, showPickers, onChange }: ProgressFiltersProps) {
  const custom = isCustomRange(state)
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(state.startDate ?? range?.startDate ?? '')
  const [to, setTo] = useState(state.endDate ?? range?.endDate ?? '')
  const [rangeError, setRangeError] = useState<string | null>(null)

  const applyCustom = (event: FormEvent) => {
    event.preventDefault()
    const start = parseCalendarDate(from)
    const end = parseCalendarDate(to)
    if (!start || !end) return setRangeError('Enter both dates.')
    if (start > end) return setRangeError('The start date must not be after the end date.')
    if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) return setRangeError('Choose at most two years.')
    setRangeError(null)
    setEditing(false)
    onChange({ startDate: from, endDate: to, page: 1 })
  }

  const teamOptions = members.filter(m => m.role !== 'labeller').map(option)
  const people = state.teamId ? members.filter(m => subtreeOf(members, state.teamId!).has(m.id)) : members
  const personOptions = people.map(option)
  const showCustomForm = editing || custom

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <fieldset>
          <legend className="mb-1 block text-xs text-gray-600">Period</legend>
          <div className="flex flex-wrap gap-1" role="group">
            {RANGE_PRESETS.map(days => {
              const active = !custom && !editing && state.days === days
              return (
                <button
                  key={days}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setEditing(false)
                    setRangeError(null)
                    onChange({ days, startDate: null, endDate: null, page: 1 })
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {PRESET_LABEL[days]}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={showCustomForm}
              onClick={() => {
                setFrom(state.startDate ?? range?.startDate ?? '')
                setTo(state.endDate ?? range?.endDate ?? '')
                setEditing(true)
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                showCustomForm ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Custom dates
            </button>
          </div>
        </fieldset>

        {showCustomForm && (
          <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-2" aria-label="Custom dates">
            <label className="text-xs text-gray-600">
              From
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-600">
              To
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              Apply
            </button>
            {rangeError && (
              <p role="alert" className="basis-full text-sm text-red-700">
                {rangeError}
              </p>
            )}
          </form>
        )}

        {showPickers && (
          <>
            <Combobox
              label="Team"
              className="w-56"
              options={teamOptions}
              value={state.teamId}
              placeholder="Whole workspace"
              emptyText="No supervisors"
              onChange={value => onChange({ teamId: value, page: 1 })}
            />
            <Combobox
              label="Person"
              className="w-56"
              options={personOptions}
              value={state.personId}
              placeholder="Everyone"
              emptyText="Nobody in this team"
              onChange={value => onChange({ personId: value, page: 1 })}
            />
          </>
        )}
      </div>
    </div>
  )
}
