'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { badgeClass, buttonClass, panelClass } from '@/components/ui/styles'
import type { QueueAIPreview, QueueAIRequest, QueueAIResult, QueueAITaxonomy } from '@/lib/contracts/ai-queue'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useWorkspacePaths } from '@/lib/workspace/urls'

const choiceClass =
  'h-4 w-4 shrink-0 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600'
const format = (count: number) => count.toLocaleString()

export default function SendToAIClient({
  queue,
  taxonomies,
  unavailable
}: {
  queue: string
  taxonomies: QueueAITaxonomy[]
  unavailable?: string
}) {
  const { href, api, workspaceId } = useWorkspacePaths()
  const back = href(`/queue${queue || '?tab=pending'}`)
  const queryClient = useQueryClient()
  const ready = taxonomies.filter(taxonomy => taxonomy.ready)
  const [taxonomyKeys, setTaxonomyKeys] = useState(() => (ready.length === 1 ? [ready[0]!.key] : []))
  const [skipExisting, setSkipExisting] = useState(true)
  const request = { queue, taxonomyKeys, skipExisting }

  function submit<T>(payload: QueueAIRequest) {
    return fetchJson<T>(api('/ai-labeling/jobs/from-queue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }

  const enqueue = useMutation({
    mutationFn: (confirmation: NonNullable<QueueAIPreview['confirmation']>) =>
      submit<QueueAIResult>({ ...request, confirmation }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiJobs(workspaceId) })
    }
  })
  const preview = useMutation({ mutationFn: () => submit<QueueAIPreview>(request) })
  const summary = preview.data
  const pending = preview.isPending || enqueue.isPending
  const stale = enqueue.error instanceof HttpError && enqueue.error.status === 409
  const confirmation = stale ? null : summary?.confirmation
  const problem = enqueue.error ?? preview.error
  const batches = summary?.taxonomies.reduce((sum, item) => sum + item.jobs, 0) ?? 0

  function clearPreview() {
    preview.reset()
    enqueue.reset()
  }

  function toggleTaxonomy(key: string, checked: boolean) {
    setTaxonomyKeys(previous => (checked ? [...previous, key] : previous.filter(value => value !== key)))
    clearPreview()
  }

  return (
    <>
      <PageHeader title="Send to AI" />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <Link href={back} className={buttonClass('ghost', 'sm', 'mb-4 -ml-3')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to queue
        </Link>
        {unavailable ? (
          <section aria-labelledby="ai-unavailable" className={`${panelClass} max-w-xl space-y-4 p-5`}>
            <h2 id="ai-unavailable" className="font-semibold">
              AI suggestions are unavailable
            </h2>
            <p className="text-sm text-gray-700">{unavailable}</p>
            <Link href={href('/admin/ai')} className={buttonClass('secondary')}>
              Open AI settings
            </Link>
          </section>
        ) : (
          <>
            <p className="mb-6 max-w-3xl text-sm text-gray-700">
              Request suggestions for records that match your queue filters. Suggestions leave human labels in place.
            </p>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className={`${panelClass} space-y-5 p-5`}>
                <fieldset disabled={pending || enqueue.isSuccess} className="space-y-3">
                  <legend className="mb-2 font-semibold">Taxonomies</legend>
                  {taxonomies.map(taxonomy => (
                    <label
                      key={taxonomy.key}
                      className="flex items-center gap-3 border border-gray-200 px-3 py-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={!taxonomy.ready}
                        checked={taxonomyKeys.includes(taxonomy.key)}
                        onChange={event => toggleTaxonomy(taxonomy.key, event.target.checked)}
                        className={choiceClass}
                      />
                      <span className="mr-auto font-medium">{taxonomy.key}</span>
                      <span className={badgeClass(taxonomy.ready ? 'accent' : 'neutral')}>
                        {taxonomy.ready ? 'Ready' : 'Sync required'}
                      </span>
                    </label>
                  ))}
                  {ready.length < taxonomies.length || taxonomies.length === 0 ? (
                    <p className="text-sm text-gray-700">
                      {taxonomies.length === 0
                        ? 'Add an active taxonomy to request suggestions.'
                        : 'Sync taxonomies to the current AI service to use them here.'}{' '}
                      <Link href={href('/admin/taxonomy')} className="font-medium text-indigo-700 underline">
                        Manage taxonomies
                      </Link>
                    </p>
                  ) : null}
                </fieldset>
                <label className="flex items-start gap-3 border-t border-gray-200 pt-4 text-sm">
                  <input
                    type="checkbox"
                    className={`${choiceClass} mt-0.5`}
                    disabled={pending || enqueue.isSuccess}
                    checked={skipExisting}
                    onChange={event => {
                      setSkipExisting(event.target.checked)
                      clearPreview()
                    }}
                  />
                  <span>
                    <span className="block font-medium">Skip records with suggestions</span>
                    <span className="text-gray-700">If unchecked, new results can replace earlier AI suggestions.</span>
                  </span>
                </label>
              </div>

              <section aria-labelledby="ai-preview" className={`${panelClass} space-y-4 p-5`}>
                <h2 id="ai-preview" className="font-semibold">
                  Job preview
                </h2>
                {summary ? (
                  <>
                    <p role="status" className="text-sm text-gray-700">
                      {format(summary.matched)} matching {summary.matched === 1 ? 'record' : 'records'}
                      {summary.protected > 0 && ` · ${format(summary.protected)} protected by double annotation`}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-medium">
                              Taxonomy
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              Ready to send
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              Already queued
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              With suggestions
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              Jobs
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {summary.taxonomies.map(item => (
                            <tr key={item.key}>
                              <th scope="row" className="px-3 py-2 text-left font-medium">
                                {item.key}
                              </th>
                              <td className="px-3 py-2 text-right tabular-nums">{format(item.eligible)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{format(item.alreadyQueued)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{format(item.existing)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{format(item.jobs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-600">
                      Records already queued are skipped. The suggestion count covers records without an active job for
                      that taxonomy.
                    </p>
                    {summary.taxonomies.some(item => item.eligible > item.limit) && (
                      <p role="alert" className="text-sm text-red-800">
                        Narrow the queue filters to at most {format(summary.taxonomies[0]!.limit)} eligible records per
                        taxonomy.
                      </p>
                    )}
                    {batches === 0 && (
                      <p className="text-sm text-gray-700">No records are ready to send for these taxonomies.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-700">
                    Preview what will be sent and how many AI jobs will be created.
                  </p>
                )}
                {problem && (
                  <p role="alert" className="text-sm text-red-800">
                    {problem.message}
                  </p>
                )}
                {enqueue.isSuccess ? (
                  <div className="space-y-2">
                    <p role="status" className="font-medium text-indigo-800">
                      Queued {format(enqueue.data.jobs)} AI {enqueue.data.jobs === 1 ? 'job' : 'jobs'}.
                    </p>
                    <Link href={href('/admin/ai-jobs')} className={buttonClass()}>
                      View AI jobs
                    </Link>
                  </div>
                ) : confirmation ? (
                  <button
                    type="button"
                    className={buttonClass()}
                    disabled={pending}
                    onClick={() => enqueue.mutate(confirmation)}
                  >
                    {enqueue.isPending ? 'Queuing…' : `Queue ${format(batches)} AI ${batches === 1 ? 'job' : 'jobs'}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={buttonClass()}
                    disabled={pending || taxonomyKeys.length === 0}
                    onClick={() => {
                      enqueue.reset()
                      preview.mutate()
                    }}
                  >
                    {preview.isPending ? 'Preparing preview…' : summary ? 'Preview again' : 'Preview jobs'}
                  </button>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  )
}
