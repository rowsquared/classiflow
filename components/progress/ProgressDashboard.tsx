'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import PageHeader from '@/components/PageHeader'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import {
  activityParams,
  effectiveGranularity,
  overviewParams,
  peopleParams,
  progressParsers,
  rangeDays,
  scopeKey,
  type ProgressUrlState
} from '@/lib/progress-url'
import { MAX_BUCKETS } from '@/lib/reporting-dates'
import type {
  PeopleSort,
  ProgressMemberOption,
  ProgressOverview,
  ProgressPeople,
  ProgressTimeline
} from '@/lib/contracts/progress'
import Section from './Section'
import WorkloadCards from './WorkloadCards'
import ActivityChart from './ActivityChart'
import PeopleTable from './PeopleTable'
import ProgressFilters from './ProgressFilters'
import { memberName, personInTeam, useSelectedMember } from './MemberPicker'
import TimeZoneDialog from './TimeZoneDialog'
import { formatDay, formatRange, formatTime, localDate } from './format'
import { buttonClass } from '@/components/ui/styles'

export type InitialReports = {
  /** The query strings the server loaded; initial data applies only while they match. */
  params: { overview: string; activity: string; people: string }
  overview: ProgressOverview | null
  activity: ProgressTimeline | null
  people: ProgressPeople | null
}

type Viewer = { id: string; role: 'admin' | 'supervisor' | 'labeller'; canEditTimeZone: boolean }

const NUMERIC_SORTS: PeopleSort[] = ['assigned', 'complete', 'remaining', 'labeled', 'lastSeen']

/**
 * Keeps a section's previous results on screen while it reloads, but only
 * for the same scope (team and person): another person's figures must never
 * appear under a newly selected person.
 */
const withinScope =
  (scope: string) =>
  <T,>(previous: T | undefined, previousQuery: Query<T, Error, T, readonly unknown[]> | undefined) =>
    previousQuery?.queryKey[4] === scope ? previous : undefined

const errorText = (error: Error | null, what: string) => (error ? `Could not load ${what}: ${error.message}` : null)

export default function ProgressDashboard({
  initial,
  selected,
  viewer
}: {
  initial: InitialReports
  /** The team and person the URL selects, as the server resolved them. */
  selected: ProgressMemberOption[]
  viewer: Viewer
}) {
  const { workspaceId, api } = useWorkspacePaths()
  const queryClient = useQueryClient()
  const [url, setUrl] = useQueryStates(progressParsers, { history: 'push' })
  const staff = viewer.role !== 'labeller'
  const scope = scopeKey(url)
  const params = { overview: overviewParams(url), activity: activityParams(url), people: peopleParams(url) }

  const overviewQuery = useQuery({
    queryKey: queryKeys.progressReport(workspaceId, 'overview', scope, params.overview),
    queryFn: ({ signal }) => fetchJson<ProgressOverview>(api(`/progress/overview?${params.overview}`), { signal }),
    initialData: params.overview === initial.params.overview ? (initial.overview ?? undefined) : undefined,
    placeholderData: withinScope(scope)
  })
  const activityQuery = useQuery({
    queryKey: queryKeys.progressReport(workspaceId, 'activity', scope, params.activity),
    queryFn: ({ signal }) => fetchJson<ProgressTimeline>(api(`/progress/activity?${params.activity}`), { signal }),
    initialData: params.activity === initial.params.activity ? (initial.activity ?? undefined) : undefined,
    placeholderData: withinScope(scope)
  })
  const peopleQuery = useQuery({
    queryKey: queryKeys.progressReport(workspaceId, 'people', scope, params.people),
    queryFn: ({ signal }) => fetchJson<ProgressPeople>(api(`/progress/people?${params.people}`), { signal }),
    initialData: params.people === initial.params.people ? (initial.people ?? undefined) : undefined,
    placeholderData: withinScope(scope),
    enabled: staff
  })

  // Search typed into the people table reaches the URL (and the server) after a pause.
  const [search, setSearch] = useState(url.q)
  const [searchedFor, setSearchedFor] = useState(url.q)
  if (url.q !== searchedFor) {
    // The URL changed underneath (back/forward): show its search.
    setSearchedFor(url.q)
    setSearch(url.q)
  }
  useEffect(() => {
    if (search === url.q) return
    const timer = setTimeout(() => {
      setSearchedFor(search)
      void setUrl({ q: search, page: 1 }, { history: 'replace' })
    }, 300)
    return () => clearTimeout(timer)
  }, [search, url.q, setUrl])

  // Announced when a filter change clears another (screen readers).
  const [announcement, setAnnouncement] = useState('')
  const [now] = useState(() => Date.now())
  const [timeZoneOpen, setTimeZoneOpen] = useState(false)

  const selectedPerson = useSelectedMember(url.personId, selected)
  const selectedTeam = useSelectedMember(url.teamId, selected)

  const change = async (patch: Partial<ProgressUrlState>) => {
    const next = { ...url, ...patch }
    // A person outside a newly chosen team would make an empty report; clear it.
    if (patch.teamId !== undefined && next.teamId && next.personId) {
      const inTeam = await personInTeam(api, next.personId, next.teamId).catch(() => true)
      if (!inTeam) {
        patch = { ...patch, personId: null }
        setAnnouncement(
          `Person filter cleared: ${selectedPerson ? memberName(selectedPerson) : 'that person'} is not in this team.`
        )
      }
    }
    void setUrl(patch)
  }

  const sortBy = (sort: PeopleSort) => {
    const dir = url.sort === sort ? (url.dir === 'asc' ? 'desc' : 'asc') : NUMERIC_SORTS.includes(sort) ? 'desc' : 'asc'
    void setUrl({ sort, dir, page: 1 })
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.progress(workspaceId) })

  const saveTimeZone = async (reportingTimezone: string | null) => {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportingTimezone })
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
        details?: Array<{ message?: string }>
      } | null
      return body?.details?.[0]?.message ?? body?.error ?? 'Could not save the time zone'
    }
    await refresh()
    return null
  }

  const meta = overviewQuery.data ?? activityQuery.data ?? peopleQuery.data ?? null
  const updatedAt = Math.max(overviewQuery.dataUpdatedAt, activityQuery.dataUpdatedAt, peopleQuery.dataUpdatedAt)
  const fetching = overviewQuery.isFetching || activityQuery.isFetching || peopleQuery.isFetching
  const coverage = meta ? localDate(meta.activityCoverageStart, meta.timeZone) : null
  const granularity = effectiveGranularity(url)
  const [activityView, setActivityView] = useState<'chart' | 'table'>('chart')
  const scopeLabel = [
    selectedTeam && `team of ${memberName(selectedTeam)}`,
    selectedPerson && memberName(selectedPerson)
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <PageHeader
        title="Progress"
        actions={
          <>
            <span className="hidden text-sm text-gray-600 sm:inline" aria-live="polite">
              {fetching ? 'Updating…' : updatedAt > 0 ? `Updated ${formatTime(updatedAt)}` : null}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={fetching}
              className={buttonClass('secondary', 'sm')}
            >
              Refresh
            </button>
          </>
        }
      />
      <div className="px-4 py-6 sm:px-8">
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        <ProgressFilters
          key={`${url.days}|${url.startDate}|${url.endDate}`}
          state={url}
          range={meta}
          known={selected}
          showPickers={staff}
          onChange={patch => void change(patch)}
        />

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
          {meta && (
            <span data-testid="report-range">
              <strong className="font-medium text-gray-900">{formatRange(meta.startDate, meta.endDate)}</strong>
              {scopeLabel ? ` · ${scopeLabel}` : staff ? ' · everyone you can see' : ' · your own work'}
            </span>
          )}
          {meta && (
            <span>
              Days in {meta.timeZone}
              {viewer.canEditTimeZone && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setTimeZoneOpen(true)}
                    className="rounded text-indigo-700 underline hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Change time zone
                  </button>
                </>
              )}
            </span>
          )}
        </div>

        {meta && coverage && coverage > meta.startDate && (
          <p
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            data-testid="coverage-notice"
          >
            {coverage > meta.endDate
              ? `Labeling activity is recorded from ${formatDay(coverage)} on, so this period shows no activity yet.`
              : `Labeling activity is recorded from ${formatDay(coverage)} on; earlier days in this period show none.`}{' '}
            Workload figures are current and not affected.
          </p>
        )}

        <Section
          id="overview"
          title="Workload now and activity"
          description="Current workload and activity in the selected dates. The projection uses complete records with human label activity minus imports per day in that period, applied to the remaining records now. A relabeled record may make the estimate optimistic. AI suggestions do not count."
          loading={!overviewQuery.data}
          updating={overviewQuery.isPlaceholderData}
          error={errorText(overviewQuery.error, 'the overview')}
          onRetry={() => void overviewQuery.refetch()}
          skeletonHeight="h-28"
        >
          {overviewQuery.data && <WorkloadCards overview={overviewQuery.data} />}
        </Section>

        <Section
          id="activity"
          title="Labeling activity over time"
          description={`Distinct records labeled per ${granularity === 'day' ? 'day' : 'Monday week'}.`}
          loading={!activityQuery.data}
          updating={activityQuery.isPlaceholderData}
          error={errorText(activityQuery.error, 'the activity timeline')}
          onRetry={() => void activityQuery.refetch()}
          skeletonHeight="h-72"
          actions={
            <>
              <div role="group" aria-label="Group by" className="flex rounded-md border border-gray-300 text-sm">
                {(['day', 'week'] as const).map(g => {
                  const disabled = g === 'day' && rangeDays(url) > MAX_BUCKETS
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={granularity === g}
                      disabled={disabled}
                      title={disabled ? `Daily view covers at most ${MAX_BUCKETS} days` : undefined}
                      onClick={() => void setUrl({ granularity: g })}
                      className={`px-3 py-1 first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                        granularity === g ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      {g === 'day' ? 'Daily' : 'Weekly'}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                aria-pressed={activityView === 'table'}
                onClick={() => setActivityView(activityView === 'chart' ? 'table' : 'chart')}
                className={buttonClass('secondary', 'sm')}
              >
                {activityView === 'chart' ? 'Show as table' : 'Show as chart'}
              </button>
            </>
          }
        >
          {activityQuery.data && <ActivityChart timeline={activityQuery.data} view={activityView} />}
        </Section>

        {staff && (
          <Section
            id="people"
            title="People"
            description="Workload by current assignment, activity by who saved the labels. Rows overlap when records are shared, so they need not add up to the totals above."
            loading={!peopleQuery.data}
            updating={peopleQuery.isPlaceholderData}
            error={errorText(peopleQuery.error, 'the people')}
            onRetry={() => void peopleQuery.refetch()}
            skeletonHeight="h-64"
            actions={
              <label className="text-sm text-gray-700">
                <span className="sr-only">Search people</span>
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search people"
                  className="w-48 rounded-md border border-gray-500 px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </label>
            }
          >
            {peopleQuery.data && (
              <PeopleTable
                people={peopleQuery.data}
                sort={url.sort}
                dir={url.dir}
                onSort={sortBy}
                onSelectPerson={personId => change({ personId, page: 1 })}
                onPage={page => void setUrl({ page })}
                now={now}
              />
            )}
          </Section>
        )}
      </div>
      {timeZoneOpen && meta && (
        <TimeZoneDialog current={meta.timeZone} onSave={saveTimeZone} onClose={() => setTimeZoneOpen(false)} />
      )}
    </>
  )
}
