'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/PageHeader'
import { buttonClass, panelClass } from '@/components/ui/styles'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { fetchJson } from '@/lib/query/fetch'
import { useActiveTaxonomies } from '@/components/labeling/data'

type Summary = { records: number; rounds: number; pairs: number; compared: number }
type AnalysisFormat = 'pairs' | 'details' | 'agreement' | 'analysis'

const selectClass =
  'w-full px-3 py-2 border border-gray-500 text-gray-900 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1'
const formatNumber = (n: number) => n.toLocaleString()

const ANALYSIS: Array<{ value: AnalysisFormat; title: string; detail: string }> = [
  {
    value: 'pairs',
    title: 'Pairs',
    detail: 'One row per record and taxonomy: answer A and B side by side, match per level, final result and review.'
  },
  { value: 'details', title: 'Answers', detail: 'Long format: one row per record, person and taxonomy.' },
  {
    value: 'agreement',
    title: 'Agreement summary',
    detail: 'Agreement by level, by labeller pair and by labeller, and the most frequent disagreements.'
  },
  { value: 'analysis', title: 'All three', detail: 'Pairs, answers and the agreement summary in one ZIP file.' }
]

/**
 * Admin downloads (GET /export, lib/export-csv.ts and lib/export-double.ts).
 * Downloads are plain links, so the browser saves the streamed file directly.
 */
export default function ExportAdminPage() {
  const { workspaceId, api } = useWorkspacePaths()
  const summary = useQuery({
    queryKey: ['ws', workspaceId, 'export-summary'],
    queryFn: ({ signal }) => fetchJson<Summary>(api('/export/summary'), { signal })
  })
  const taxonomies = useActiveTaxonomies()
  const usesDouble = (summary.data?.rounds ?? 0) > 0

  // Records
  const [statusFilter, setStatusFilter] = useState('all')
  // all: every record with its current labels (double annotation may still be provisional); confirmed: final labels only.
  const [labels, setLabels] = useState<'all' | 'confirmed'>('all')
  const [statusColumns, setStatusColumns] = useState<boolean | null>(null)
  const withStatus = statusColumns ?? usesDouble

  // Double annotation analysis
  const [format, setFormat] = useState<AnalysisFormat>('pairs')
  const [rounds, setRounds] = useState('all')
  const [taxonomy, setTaxonomy] = useState('')
  const [comparedFrom, setComparedFrom] = useState('')
  const [comparedTo, setComparedTo] = useState('')
  const [includeText, setIncludeText] = useState(true)

  const recordsUrl = () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (labels === 'confirmed') params.set('labels', 'confirmed')
    params.set('statusColumns', String(withStatus))
    return api(`/export?${params}`)
  }
  const analysisUrl = () => {
    const params = new URLSearchParams({ format })
    if (rounds !== 'all') params.set('rounds', rounds)
    if (taxonomy) params.set('taxonomy', taxonomy)
    if (comparedFrom) params.set('comparedFrom', comparedFrom)
    if (comparedTo) params.set('comparedTo', comparedTo)
    if ((format === 'pairs' || format === 'analysis') && !includeText) params.set('text', 'false')
    return api(`/export?${params}`)
  }

  return (
    <>
      <PageHeader title="Export data" />
      <div className="px-8 py-8 space-y-6 max-w-6xl">
        <section aria-labelledby="export-records" className={`${panelClass} p-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 id="export-records" className="text-lg font-semibold text-gray-900">
              Records
            </h2>
            {summary.data && (
              <span className="text-sm text-gray-600">{formatNumber(summary.data.records)} records</span>
            )}
          </div>
          <p className="text-sm text-gray-600 mb-4">
            One row per record: the original field and support columns, human labels ({'{taxonomyKey}'}_1, _2, …), AI
            suggestions with confidence ({'{taxonomyKey}'}_ai1, _ai1c, …), status, flagged, last editor, last edited and
            comments. Unknown codes export as UNKNOWN.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-end">
            <div>
              <label htmlFor="export-labels" className={labelClass}>
                Labels
              </label>
              <select
                id="export-labels"
                value={labels}
                onChange={e => setLabels(e.target.value === 'confirmed' ? 'confirmed' : 'all')}
                className={selectClass}
              >
                <option value="all">All available labels</option>
                <option value="confirmed">Confirmed records only</option>
              </select>
            </div>
            <div>
              <label htmlFor="export-status" className={labelClass}>
                Status
              </label>
              <select
                id="export-status"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={selectClass}
              >
                <option value="all">All</option>
                <option value="submitted">Submitted only</option>
                <option value="pending">Pending only</option>
                <option value="skipped">Skipped only</option>
              </select>
            </div>
            <a href={recordsUrl()} download className={buttonClass('primary', 'md', 'justify-center')}>
              Download records CSV
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-600">
            Confirmed records only: complete ordinary work, and double annotation that agreed, was decided by a reviewer
            or was accepted as a single label.
          </p>
          <div className="mt-4 pt-4 border-t border-gray-200">
            <label className="flex items-start gap-2 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={withStatus}
                onChange={e => setStatusColumns(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Include annotation status columns
                <span className="block text-xs text-gray-600">
                  annotation_mode, annotation_status and {'{taxonomyKey}'}_annotation_status (single, provisional,
                  disagreed, agreed, reviewed, accepted_single).{' '}
                  {usesDouble
                    ? 'On by default because this workspace uses double annotation.'
                    : 'Off by default: this workspace does not use double annotation.'}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="export-double" className={`${panelClass} p-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 id="export-double" className="text-lg font-semibold text-gray-900">
              Double annotation analysis
            </h2>
            {summary.data && (
              <span className="text-sm text-gray-600">
                {formatNumber(summary.data.rounds)} rounds · {formatNumber(summary.data.pairs)} pairs ·{' '}
                {formatNumber(summary.data.compared)} compared
              </span>
            )}
          </div>
          {summary.data && !usesDouble ? (
            <p className="text-sm text-gray-600">
              No records were double annotated yet. Start double annotation from the queue (Assign, then “Two
              independent labels”).
            </p>
          ) : (
            <>
              <fieldset>
                <legend className={labelClass}>File</legend>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {ANALYSIS.map(option => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-2 p-3 border cursor-pointer text-sm ${
                        format === option.value ? 'border-indigo-600 bg-indigo-50' : 'border-gray-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="analysis-format"
                        value={option.value}
                        checked={format === option.value}
                        onChange={() => setFormat(option.value)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-gray-900">{option.title}</span>
                        <span className="block text-gray-600">{option.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="analysis-rounds" className={labelClass}>
                    Rounds
                  </label>
                  <select
                    id="analysis-rounds"
                    value={rounds}
                    onChange={e => setRounds(e.target.value)}
                    className={selectClass}
                  >
                    <option value="all">All</option>
                    <option value="completed">Confirmed</option>
                    <option value="active">Open</option>
                    <option value="cancelled">Stopped</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="analysis-taxonomy" className={labelClass}>
                    Taxonomy
                  </label>
                  <select
                    id="analysis-taxonomy"
                    value={taxonomy}
                    onChange={e => setTaxonomy(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {(taxonomies.data ?? []).map(t => (
                      <option key={t.key} value={t.key}>
                        {t.key}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="analysis-from" className={labelClass}>
                    Compared from
                  </label>
                  <input
                    id="analysis-from"
                    type="date"
                    value={comparedFrom}
                    onChange={e => setComparedFrom(e.target.value)}
                    className={selectClass}
                  />
                </div>
                <div>
                  <label htmlFor="analysis-to" className={labelClass}>
                    Compared to
                  </label>
                  <input
                    id="analysis-to"
                    type="date"
                    value={comparedTo}
                    onChange={e => setComparedTo(e.target.value)}
                    className={selectClass}
                  />
                </div>
              </div>
              {(format === 'pairs' || format === 'analysis') && (
                <label className="mt-4 flex items-center gap-2 text-sm text-gray-900">
                  <input type="checkbox" checked={includeText} onChange={e => setIncludeText(e.target.checked)} />
                  Include record text (field and support columns)
                </label>
              )}
              <p className="mt-3 text-xs text-gray-600">
                Codes are exported as they were chosen, including the level-specific unknown codes (-9, -99, …).
                Agreement compares the first two answers as they were when compared; later changes are marked.
              </p>
              <div className="mt-4">
                <a href={analysisUrl()} download className={buttonClass('secondary')}>
                  {format === 'analysis'
                    ? 'Download all three (ZIP)'
                    : `Download ${ANALYSIS.find(a => a.value === format)!.title.toLowerCase()} CSV`}
                </a>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}
