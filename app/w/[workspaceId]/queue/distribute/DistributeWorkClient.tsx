'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { buttonClass, panelClass } from '@/components/ui/styles'
import {
  MAX_DISTRIBUTION_LABELLERS,
  type DistributionLabeller,
  type DistributionPreview,
  type DistributionRequest,
  type DistributionResult
} from '@/lib/contracts/distribution'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useWorkspacePaths } from '@/lib/workspace/urls'

const modes = [
  {
    value: 'even',
    label: 'Even random split',
    description: 'Give each labeller about the same number of new records.'
  },
  {
    value: 'workload',
    label: 'Balance existing workloads',
    description: 'Give each new record to the labeller with the fewest open assignments after the split so far.'
  }
] as const

const choiceClass =
  'h-4 w-4 shrink-0 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600'
const format = (count: number) => count.toLocaleString()

export default function DistributeWorkClient({
  queue,
  labellers
}: {
  queue: string
  labellers: DistributionLabeller[]
}) {
  const { href, api, workspaceId } = useWorkspacePaths()
  const back = href(`/queue${queue || '?tab=pending'}`)
  const queryClient = useQueryClient()
  const [labellerIds, setLabellerIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<DistributionRequest['mode']>('even')
  const request = { queue, labellerIds, mode }
  const endpoint = api('/sentences/assign/distribute')

  function submit<T>(payload: DistributionRequest) {
    return fetchJson<T>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }

  const confirm = useMutation({
    mutationFn: (confirmation: NonNullable<DistributionPreview['confirmation']>) =>
      submit<DistributionResult>({ ...request, confirmation }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queue(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.progress(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId).concat('assignments') })
      ])
    }
  })
  const preview = useMutation({ mutationFn: () => submit<DistributionPreview>(request) })
  const summary = preview.data
  const pending = preview.isPending || confirm.isPending
  const finished = confirm.isSuccess
  const stale = confirm.error instanceof HttpError && confirm.error.status === 409
  const confirmation = stale ? null : summary?.confirmation
  const problem = confirm.error ?? preview.error
  const needle = search.trim().toLowerCase()
  const shown = labellers.filter(person =>
    [person.name, person.email].some(value => value.toLowerCase().includes(needle))
  )

  function clearPreview() {
    preview.reset()
    confirm.reset()
  }

  function toggleLabeller(id: string, checked: boolean) {
    setLabellerIds(previous => (checked ? [...previous, id] : previous.filter(value => value !== id)))
    clearPreview()
  }

  return (
    <>
      <PageHeader title="Distribute work" />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <Link href={back} className={buttonClass('ghost', 'sm', 'mb-4 -ml-3')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to queue
        </Link>
        <p className="mb-6 max-w-3xl text-sm text-gray-700">
          Split pending records from your queue selection among labellers. The split leaves out records already assigned
          to an active labeller, records in active double-annotation rounds, and records with unreleased parts.
        </p>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
          <div className={`${panelClass} space-y-5 p-5`}>
            <fieldset disabled={pending || finished} className="min-w-0 space-y-3">
              <legend className="mb-2 font-semibold">Labellers</legend>
              <p className="text-sm text-gray-700">
                {labellers.length < 2
                  ? 'At least two active labellers are needed.'
                  : `${labellerIds.length} selected · choose at least two`}
              </p>
              {labellers.length > 0 && (
                <>
                  <label htmlFor="distribution-search" className="block text-sm font-medium">
                    Search labellers
                  </label>
                  <input
                    id="distribution-search"
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    className="w-full rounded-sm border border-gray-500 px-3 py-2 text-sm focus-visible:outline-indigo-600"
                  />
                  <div className="max-h-64 divide-y divide-gray-200 overflow-y-auto border border-gray-200">
                    {shown.length === 0 && <p className="p-3 text-sm text-gray-700">No matching labellers.</p>}
                    {shown.map(person => {
                      const checked = labellerIds.includes(person.id)
                      return (
                        <label
                          key={person.id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={event => toggleLabeller(person.id, event.target.checked)}
                            disabled={!checked && labellerIds.length >= MAX_DISTRIBUTION_LABELLERS}
                            className={choiceClass}
                          />
                          <span className="min-w-0 break-all text-sm">
                            {person.name}
                            {person.email !== person.name && (
                              <span className="block text-xs text-gray-600">{person.email}</span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </fieldset>

            <fieldset disabled={pending || finished} className="space-y-2">
              <legend className="mb-2 font-semibold">Distribution method</legend>
              {modes.map(option => (
                <label
                  className="flex cursor-pointer items-start gap-3 border border-gray-200 p-3 hover:bg-gray-50"
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="distribution-mode"
                    className={`${choiceClass} mt-0.5`}
                    checked={mode === option.value}
                    onChange={() => {
                      setMode(option.value)
                      clearPreview()
                    }}
                  />
                  <span className="text-sm">
                    <span className="block font-medium">{option.label}</span>
                    <span className="text-gray-700">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <section aria-labelledby="distribution-preview" className={`${panelClass} space-y-4 p-5`}>
            <h2 id="distribution-preview" className="font-semibold">
              Distribution preview
            </h2>
            {summary ? (
              <>
                <p role="status" className="text-sm text-gray-700">
                  {format(summary.matched)} matching · {format(summary.eligible)} eligible ·{' '}
                  {format(summary.matched - summary.eligible)} left out
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Labeller
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Open now
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          New
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          After
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {summary.people.map(person => (
                        <tr key={person.id}>
                          <th scope="row" className="px-3 py-2 text-left font-medium">
                            {labellers.find(labeller => labeller.id === person.id)?.name}
                          </th>
                          <td className="px-3 py-2 text-right tabular-nums">{format(person.open)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{format(person.added)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{format(person.open + person.added)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {summary.eligible > summary.maxRecords && (
                  <p role="alert" className="text-sm text-red-800">
                    Narrow the queue filters to at most {format(summary.maxRecords)} eligible records per distribution.
                  </p>
                )}
                {summary.eligible === 0 && (
                  <p className="text-sm text-gray-700">No eligible records in this selection.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-700">Preview how much work each selected labeller would receive.</p>
            )}
            {problem && (
              <p role="alert" className="text-sm text-red-800">
                {problem.message}
              </p>
            )}
            {finished ? (
              <p role="status" className="font-medium text-indigo-800">
                Assigned {format(confirm.data.assigned)} {confirm.data.assigned === 1 ? 'record' : 'records'}.
              </p>
            ) : confirmation ? (
              <button
                type="button"
                className={buttonClass()}
                disabled={pending}
                onClick={() => confirm.mutate(confirmation)}
              >
                {confirm.isPending
                  ? 'Assigning…'
                  : `Assign ${format(summary!.eligible)} ${summary!.eligible === 1 ? 'record' : 'records'}`}
              </button>
            ) : (
              <button
                type="button"
                className={buttonClass()}
                disabled={pending || labellerIds.length < 2}
                onClick={() => {
                  confirm.reset()
                  preview.mutate()
                }}
              >
                {preview.isPending ? 'Preparing preview…' : summary ? 'Preview again' : 'Preview distribution'}
              </button>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
