import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import Modal from '@/components/Modal'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import type { DoubleProgress } from '@/lib/contracts/progress'
import { serializeQueueUrlState } from '@/lib/queue-url'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import Section from './Section'
import { formatNumber, percent } from './format'

const kappaText = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toFixed(2))

const share = (part: number, whole: number) => {
  const value = percent(part, whole)
  return value === null ? '–' : `${value}%`
}

const th = 'px-3 py-2 font-medium'
const thNum = `${th} text-right`
const td = 'px-3 py-2'
const tdNum = `${td} text-right tabular-nums`
const breakdownHeading =
  'flex cursor-pointer list-none items-center justify-between gap-2 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 [&::-webkit-details-marker]:hidden'

export default function DoubleAnnotationCards({
  double,
  updating,
  onRetry
}: {
  double: DoubleProgress
  updating: boolean
  onRetry: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const figures = [
    { label: 'In progress', value: double.inProgress, tone: 'border-gray-200 bg-gray-50 text-gray-900' },
    {
      label: 'Needs review',
      value: double.needsReview,
      tone:
        double.needsReview > 0
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-gray-200 bg-gray-50 text-gray-900'
    },
    { label: 'Confirmed', value: double.confirmed, tone: 'border-indigo-100 bg-indigo-50 text-indigo-900' }
  ]

  return (
    <>
      <Section
        id="double-annotation"
        title="Double annotation"
        loading={false}
        updating={updating}
        error={null}
        onRetry={onRetry}
        actions={
          <button
            type="button"
            aria-haspopup="dialog"
            className={buttonClass('secondary', 'sm')}
            onClick={() => setDetailsOpen(true)}
          >
            View details
          </button>
        }
      >
        <div className="max-w-2xl" data-testid="double-annotation">
          <dl className="grid grid-cols-3 gap-3">
            {figures.map(f => (
              <div key={f.label} className={`min-w-0 border p-2 sm:px-4 sm:py-3 ${f.tone}`}>
                <dt className="text-sm">{f.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{formatNumber(f.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-600">Agreement this period</span>
            {double.agreement.length > 0 ? (
              <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
                {double.agreement.map(a => (
                  <div key={a.taxonomyKey} className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="wrap-anywhere text-gray-700">{a.taxonomyKey}</dt>
                    <dd className="font-medium tabular-nums text-gray-900">{share(a.agreed, a.compared)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-gray-600">No pairs compared</span>
            )}
          </div>
        </div>
      </Section>

      {detailsOpen && <DoubleAnnotationDetails double={double} onClose={() => setDetailsOpen(false)} />}
    </>
  )
}

function DoubleAnnotationDetails({ double, onClose }: { double: DoubleProgress; onClose: () => void }) {
  const figures = [
    { label: 'Need another labeller', value: double.needsPerson, attention: true },
    { label: 'Parts open over 7 days', value: double.waiting.over7, attention: true },
    { label: 'Parts open over 14 days', value: double.waiting.over14, attention: true },
    { label: 'Reviewed this period', value: double.reviewedInPeriod, attention: false }
  ]
  return (
    <Modal label="Double annotation details" onClose={onClose} closeOnOverlayClick>
      <div className={`${dialogPanelClass} flex max-h-[85dvh] w-full max-w-4xl flex-col`}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 className="text-lg font-semibold text-gray-900">Double annotation details</h2>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {figures.map(f => (
                <div
                  key={f.label}
                  className={`border px-3 py-2 ${f.attention && f.value > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-900'}`}
                >
                  <dt className="text-xs">{f.label}</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums">{formatNumber(f.value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-gray-600">In progress includes records that need review.</p>
          </div>
          <DoubleAnnotationBreakdowns double={double} />
        </div>
      </div>
    </Modal>
  )
}

function DoubleAnnotationBreakdowns({ double }: { double: DoubleProgress }) {
  const [showKappa, setShowKappa] = useState(false)
  const { href } = useWorkspacePaths()
  // The queue lists the records of a disagreement over all periods.
  const recordsHref = (c: DoubleProgress['confusions'][number]) =>
    href(`/queue${serializeQueueUrlState({ tab: 'all', disagreement: [c.taxonomyKey, String(c.level), c.a, c.b] })}`)
  const levels = Math.max(1, ...double.agreementByLevel.map(t => t.agreed.length))
  return (
    <>
      <section aria-labelledby="agreement-breakdown-heading">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="agreement-breakdown-heading" className="text-base font-semibold text-gray-900">
              Agreement by level
            </h3>
            <p className="text-sm text-gray-600">Original labels this period, before review</p>
          </div>
          {double.agreement.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="size-4 accent-indigo-700"
                checked={showKappa}
                onChange={e => setShowKappa(e.target.checked)}
              />
              Show Fleiss’ kappa
            </label>
          )}
        </div>
        {showKappa && <p className="mb-2 text-xs text-gray-600">Kappa (κ) adjusts agreement for chance.</p>}
        <div className="overflow-x-auto border border-gray-200">
          <table aria-labelledby="agreement-breakdown-heading" className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                <th scope="col" className={th}>
                  Taxonomy
                </th>
                {Array.from({ length: levels }, (_, i) => (
                  <th key={i} scope="col" className={thNum}>
                    Level {i + 1}
                  </th>
                ))}
                <th scope="col" className={`${thNum} whitespace-nowrap bg-indigo-50 text-indigo-900`}>
                  Full path
                </th>
              </tr>
            </thead>
            <tbody>
              {double.agreement.length === 0 ? (
                <tr>
                  <td colSpan={levels + 2} className={`${td} text-gray-600`}>
                    No records were compared in this period.
                  </td>
                </tr>
              ) : (
                double.agreement.map(a => {
                  const byLevel = double.agreementByLevel.find(t => t.taxonomyKey === a.taxonomyKey)
                  return (
                    <tr key={a.taxonomyKey} className="border-b border-gray-100 last:border-b-0">
                      <th scope="row" className={`${td} max-w-32 wrap-anywhere text-left font-medium text-gray-900`}>
                        {a.taxonomyKey}
                      </th>
                      {Array.from({ length: levels }, (_, i) => {
                        const agreed = byLevel?.agreed[i]
                        return (
                          <td key={i} className={`${tdNum} align-top`} title={byLevel?.levelNames[i] ?? undefined}>
                            {agreed !== undefined && (
                              <AgreementRate
                                agreed={agreed}
                                compared={a.compared}
                                kappa={showKappa ? kappaText(byLevel?.kappa[i]) : undefined}
                              />
                            )}
                          </td>
                        )
                      })}
                      <td className={`${tdNum} bg-indigo-50/50 align-top text-indigo-900`}>
                        <AgreementRate
                          agreed={a.agreed}
                          compared={a.compared}
                          kappa={showKappa ? kappaText(byLevel?.fullKappa) : undefined}
                        />
                        <span className="mt-1 block whitespace-nowrap text-xs text-gray-600">
                          {formatNumber(a.agreed)} of {formatNumber(a.compared)} pairs
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {double.labellers.length > 0 && (
        <div className="space-y-2">
          <details className="group border border-gray-200">
            <summary className={breakdownHeading}>
              By labeller
              <ChevronDown className="size-4 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">By labeller</caption>
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th scope="col" className={th}>
                      Labeller
                    </th>
                    <th scope="col" className={thNum}>
                      Compared
                    </th>
                    <th scope="col" className={thNum}>
                      Agreed
                    </th>
                    <th scope="col" className={thNum}>
                      Reviewer chose theirs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {double.labellers.map(l => (
                    <tr key={l.name} className="border-b border-gray-100">
                      <td className={`${td} wrap-anywhere text-gray-900`}>{l.name}</td>
                      <td className={tdNum}>{formatNumber(l.compared)}</td>
                      <td className={tdNum}>{share(l.agreed, l.compared)}</td>
                      <td className={tdNum}>
                        {l.decided > 0 ? `${formatNumber(l.chosen)} of ${formatNumber(l.decided)}` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="group border border-gray-200">
            <summary className={breakdownHeading}>
              <span className="flex flex-wrap items-center gap-x-2">
                Most frequent disagreements
                <span className="font-normal tabular-nums text-gray-600">
                  ({formatNumber(double.confusions.length)})
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Most frequent disagreements</caption>
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th scope="col" className={th}>
                      Codes
                    </th>
                    <th scope="col" className={thNum}>
                      Level
                    </th>
                    <th scope="col" className={thNum}>
                      Pairs
                    </th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Records</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {double.confusions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-2 text-gray-600">
                        No disagreements in this period.
                      </td>
                    </tr>
                  ) : (
                    double.confusions.map(c => (
                      <tr key={`${c.taxonomyKey}-${c.level}-${c.a}-${c.b}`} className="border-b border-gray-100">
                        <td className={`${td} wrap-anywhere text-gray-900`}>
                          <span className="text-gray-600">{c.taxonomyKey}</span>{' '}
                          <span className="font-mono">{c.a}</span> {c.aLabel ?? ''} ↔{' '}
                          <span className="font-mono">{c.b}</span> {c.bLabel ?? ''}
                        </td>
                        <td className={tdNum}>{c.level}</td>
                        <td className={tdNum}>{formatNumber(c.count)}</td>
                        <td className={td}>
                          <Link
                            href={recordsHref(c)}
                            className="text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            title="All records with this disagreement, from every period"
                          >
                            Show records<span className="sr-only">{` for ${c.taxonomyKey} ${c.a} and ${c.b}`}</span>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </>
  )
}

function AgreementRate({ agreed, compared, kappa }: { agreed: number; compared: number; kappa?: string }) {
  const rate = percent(agreed, compared)
  return (
    <>
      <span className="font-medium">{rate === null ? '–' : `${rate}%`}</span>
      {rate !== null && (
        <div className="ml-auto mt-1 h-1 w-10 bg-indigo-100 sm:w-14" aria-hidden="true">
          <div className="h-full bg-indigo-600" style={{ width: `${rate}%` }} />
        </div>
      )}
      {kappa !== undefined && <span className="mt-1 block whitespace-nowrap text-xs text-gray-600">κ {kappa}</span>}
    </>
  )
}
