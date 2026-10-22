'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import type { ProgressMemberOption, ProgressMembers } from '@/lib/contracts/progress'

// The Progress page's team and person pickers search the server
// (/progress/members), so a workspace with thousands of members never sends
// its whole directory to the browser.

const ROLE_HINT = { admin: 'admin', supervisor: 'supervisor', labeller: 'labeller' } as const

export const memberName = (m: Pick<ProgressMemberOption, 'name' | 'username'>) => m.name || m.username

const option = (m: ProgressMemberOption): ComboboxOption => ({
  value: m.userId,
  label: memberName(m),
  hint: m.status === 'suspended' ? `${ROLE_HINT[m.role]}, inactive` : ROLE_HINT[m.role]
})

/** Fetches /progress/members with these parameters. */
function useMemberSearch(params: URLSearchParams, opts: { enabled?: boolean; initialData?: ProgressMembers } = {}) {
  const { workspaceId, api } = useWorkspacePaths()
  const query = params.toString()
  return useQuery({
    queryKey: queryKeys.progressMembers(workspaceId, query),
    queryFn: ({ signal }) => fetchJson<ProgressMembers>(api(`/progress/members?${query}`), { signal }),
    enabled: opts.enabled,
    initialData: opts.initialData,
    staleTime: 60_000
  })
}

/**
 * Name and role of one selected member (for labels), or null while unknown.
 * `known` are members the server already resolved (the initial selection).
 */
export function useSelectedMember(userId: string | null, known: ProgressMemberOption[] = []) {
  const initial = known.find(m => m.userId === userId)
  const { data } = useMemberSearch(new URLSearchParams(userId ? { userId, limit: '1' } : {}), {
    enabled: userId !== null,
    initialData: initial ? { members: [initial], more: false } : undefined
  })
  return userId ? (data?.members[0] ?? null) : null
}

/** Whether a person is in a team (by the server's current supervisor tree). */
export async function personInTeam(api: (path: string) => string, personId: string, teamId: string) {
  const params = new URLSearchParams({ kind: 'person', teamId, userId: personId, limit: '1' })
  const result = await fetchJson<ProgressMembers>(api(`/progress/members?${params}`))
  return result.members.length > 0
}

type MemberPickerProps = {
  label: string
  kind: 'team' | 'person'
  /** Persons only: limit the search to this team. */
  teamId?: string | null
  value: string | null
  known?: ProgressMemberOption[]
  placeholder: string
  emptyText: string
  onChange: (value: string | null) => void
}

export default function MemberPicker({
  label,
  kind,
  teamId = null,
  value,
  known,
  placeholder,
  emptyText,
  onChange
}: MemberPickerProps) {
  const [text, setText] = useState('')
  const q = useDebouncedValue(text.trim(), 250)
  const params = new URLSearchParams({ kind })
  if (q) params.set('q', q)
  if (kind === 'person' && teamId) params.set('teamId', teamId)
  const { data, isFetching } = useMemberSearch(params)
  const selected = useSelectedMember(value, known)

  return (
    <Combobox
      label={label}
      className="w-56"
      options={(data?.members ?? []).map(option)}
      value={value}
      selectedLabel={selected ? memberName(selected) : undefined}
      onQueryChange={setText}
      loading={isFetching}
      placeholder={placeholder}
      emptyText={emptyText}
      onChange={next => onChange(next)}
    >
      {data?.more && <p className="mt-1 text-xs text-gray-600">Type a name to find more people.</p>}
    </Combobox>
  )
}
