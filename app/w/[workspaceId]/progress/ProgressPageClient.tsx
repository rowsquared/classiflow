"use client"
import { workspaceApi } from '@/lib/workspace/urls'
import { useState, useEffect, useRef, useCallback } from 'react'
import PageHeader from '@/components/PageHeader'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts'

export type Period = 'day' | 'week' | 'month' | 'custom'

export type Stats = {
  period: {
    start: string
    end: string
    daysInPeriod: number
  }
  metrics: {
    completion: {
      current: number
      previous: number
      total: number
      rate: number
    }
    velocity: {
      current: number
      previous: number
      estimatedDaysToComplete: number | null
    }
    aiAgreement: {
      current: number | null
      previous: number | null
      totalComparisons: number
    }
    medianTime: {
      current: number | null
      previous: number | null
    }
    unknownRates: Array<{
      level: number
      unknownCount: number
      totalCount: number
      rate: number
    }>
    flags: {
      current: number
      previous: number
    }
    comments: {
      current: number
      previous: number
    }
  }
}

export type Timeline = {
  date: string
  completed: number
  skipped: number
  flagged: number
}

export type TeamMember = {
  id: string
  name: string | null
  email: string | null
  role: string
  stats: {
    totalAssigned: number
    totalCompleted: number
    pending: number
    completedInPeriod: number
    skippedInPeriod: number
    flaggedInPeriod: number
    medianTime: number | null
    aiAgreementRate: number | null
    aiAgreementTotal: number
  }
}

type Props = {
  initialStats: Stats | null
  initialTimeline: Timeline[]
  initialTeam: TeamMember[]
  userRole: 'admin' | 'supervisor' | 'labeller'
  defaultPeriod?: Period
}

export default function ProgressPageClient({
  initialStats,
  initialTimeline,
  initialTeam,
  userRole,
  defaultPeriod = 'week'
}: Props) {
  const [period, setPeriod] = useState<Period>(defaultPeriod)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [stats, setStats] = useState<Stats | null>(initialStats)
  const [timeline, setTimeline] = useState<Timeline[]>(initialTimeline)
  const [team, setTeam] = useState<TeamMember[]>(initialTeam)
  const [loading, setLoading] = useState(!initialStats)
  const initialFetchSkipped = useRef(false)

  // Calculate date range based on selected period
  const getDateRange = useCallback(() => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    let start = new Date()
    start.setHours(0, 0, 0, 0)

    switch (period) {
      case 'day':
        // Today
        break
      case 'week':
        // Last 7 days
        start.setDate(start.getDate() - 6)
        break
      case 'month':
        // Last 30 days
        start.setDate(start.getDate() - 29)
        break
      case 'custom':
        if (customStart && customEnd) {
          start = new Date(customStart)
          return {
            startDate: start.toISOString(),
            endDate: new Date(customEnd).toISOString()
          }
        }
        break
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }
  }, [period, customStart, customEnd])

  // Load stats
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { startDate, endDate } = getDateRange()

      const statsRes = await fetch(workspaceApi(`/progress/stats?startDate=${startDate}&endDate=${endDate}`))
      if (statsRes.ok) {
        const statsData = await statsRes.json()
        if (statsData.ok) {
          setStats(statsData)
        }
      }

      const timelineRes = await fetch(
        workspaceApi(`/progress/timeline?startDate=${startDate}&endDate=${endDate}&granularity=day`)
      )
      if (timelineRes.ok) {
        const timelineData = await timelineRes.json()
        setTimeline(timelineData.timeline || [])
      }

      if (userRole === 'supervisor' || userRole === 'admin') {
        const teamRes = await fetch(workspaceApi(`/progress/team?startDate=${startDate}&endDate=${endDate}`))
        if (teamRes.ok) {
          const teamData = await teamRes.json()
          setTeam(teamData.team || [])
        }
      }
    } catch (error) {
      console.error('Failed to load progress data:', error)
    } finally {
      setLoading(false)
    }
  }, [getDateRange, userRole])

  useEffect(() => {
    if (!initialFetchSkipped.current) {
      initialFetchSkipped.current = true
      return
    }
    loadData()
  }, [loadData])

  const formatSeconds = (seconds: number | null) => {
    if (!seconds) return 'N/A'
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const getChangeIndicator = (current: number, previous: number) => {
    if (previous === 0) return null
    const change = ((current - previous) / previous) * 100
    const isPositive = change > 0
    const color = isPositive ? 'text-green-600' : 'text-red-600'
    const arrow = isPositive ? '↑' : '↓'
    return (
      <span className={`text-sm font-medium ${color}`}>
        {arrow} {Math.abs(Math.round(change))}%
      </span>
    )
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Progress" />
        <div className="px-8 py-8">
          <div className="text-center text-gray-600">Loading...</div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Progress" />
      <div className="px-8 py-8">
        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setPeriod('day')}
            className={`px-4 py-2 rounded-lg font-medium ${
              period === 'day'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setPeriod('week')}
            className={`px-4 py-2 rounded-lg font-medium ${
              period === 'week'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setPeriod('month')}
            className={`px-4 py-2 rounded-lg font-medium ${
              period === 'month'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Month
          </button>
          <button
            onClick={() => setPeriod('custom')}
            className={`px-4 py-2 rounded-lg font-medium ${
              period === 'custom'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Custom
          </button>

          {period === 'custom' && (
            <div className="flex gap-2 ml-4">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
              <span className="self-center text-gray-600">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          )}
        </div>

        {/* Core Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Completion */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">Completion Rate</p>
            <p className="text-4xl font-bold text-gray-900">{stats?.metrics?.completion?.rate || 0}%</p>
            <p className="text-sm text-gray-600 mt-2">
              {stats?.metrics?.completion?.current || 0} of {stats?.metrics?.completion?.total || 0}
            </p>
            <div className="mt-2">
              {stats?.metrics?.completion && getChangeIndicator(
                stats.metrics.completion.current || 0,
                stats.metrics.completion.previous || 0
              )}
            </div>
          </div>

          {/* Velocity */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">Velocity</p>
            <p className="text-4xl font-bold text-gray-900">
              {stats?.metrics?.velocity?.current?.toFixed(1) || 0}
            </p>
            <p className="text-sm text-gray-600 mt-2">per day</p>
            <div className="mt-2">
              {stats?.metrics?.velocity?.estimatedDaysToComplete && (
                <p className="text-sm text-indigo-600 font-medium">
                  ~{stats.metrics.velocity.estimatedDaysToComplete} days to complete
                </p>
              )}
            </div>
          </div>

          {/* AI Agreement */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">AI Agreement</p>
            <p className="text-4xl font-bold text-gray-900">
              {stats?.metrics?.aiAgreement?.current !== null && stats?.metrics?.aiAgreement?.current !== undefined
                ? `${stats.metrics.aiAgreement.current}%` 
                : 'N/A'}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              {stats?.metrics?.aiAgreement?.totalComparisons || 0} comparisons
            </p>
            <div className="mt-2">
              {stats?.metrics?.aiAgreement?.current !== null && 
               stats?.metrics?.aiAgreement?.previous !== null &&
               stats?.metrics &&
               getChangeIndicator(
                 stats.metrics.aiAgreement.current,
                 stats.metrics.aiAgreement.previous
               )}
            </div>
          </div>

          {/* Median Time */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">Median Time</p>
            <p className="text-4xl font-bold text-gray-900">
              {formatSeconds(stats?.metrics?.medianTime?.current || null)}
            </p>
            <p className="text-sm text-gray-600 mt-2">per sentence</p>
            <div className="mt-2">
              {stats?.metrics?.medianTime?.current && 
               stats?.metrics?.medianTime?.previous &&
               stats?.metrics &&
               getChangeIndicator(
                 stats.metrics.medianTime.current,
                 stats.metrics.medianTime.previous
               )}
            </div>
          </div>
        </div>

        {/* Flags & Comments */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">Flags</p>
            <p className="text-3xl font-bold text-red-600">
              {stats?.metrics?.flags?.current || 0}
            </p>
            <div className="mt-2">
              {stats?.metrics?.flags && getChangeIndicator(
                stats.metrics.flags.current || 0,
                stats.metrics.flags.previous || 0
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-600 mb-2">Comments</p>
            <p className="text-3xl font-bold text-indigo-600">
              {stats?.metrics?.comments?.current || 0}
            </p>
            <div className="mt-2">
              {stats?.metrics?.comments && getChangeIndicator(
                stats.metrics.comments.current || 0,
                stats.metrics.comments.previous || 0
              )}
            </div>
          </div>
        </div>

        {/* Submitted & Skipped by Day */}
        {timeline.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Daily Activity ({timeline.length} days)
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(value) => new Date(String(value)).toLocaleDateString()}
                  formatter={(value) => [value, '']}
                />
                <Legend />
                  <ReferenceLine 
                    y={timeline.reduce((sum, day) => sum + day.completed, 0) / timeline.length} 
                    stroke="#4f46e5" 
                    strokeDasharray="5 5"
                    label={{ 
                      value: `Avg: ${(timeline.reduce((sum, day) => sum + day.completed, 0) / timeline.length).toFixed(1)}`, 
                      position: 'right', 
                      fill: '#4f46e5', 
                      fontSize: 12 
                    }}
                  />
                <Bar dataKey="completed" stackId="a" fill="#10b981" name="Submitted" />
                <Bar dataKey="skipped" stackId="a" fill="#f59e0b" name="Skipped" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Activity</h3>
            <p className="text-gray-600">No activity data available for this period.</p>
          </div>
        )}

        {/* Team Performance (Supervisor/Admin only) */}
        {(userRole === 'supervisor' || userRole === 'admin') && team.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Performance</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Assigned
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Completed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pending
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      In Period
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Median Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      AI Agreement
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {team.map((member) => (
                    <tr key={member.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{member.name}</div>
                        <div className="text-sm text-gray-500">{member.role}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.stats.totalAssigned}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.stats.totalCompleted}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.stats.pending}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.stats.completedInPeriod}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatSeconds(member.stats.medianTime)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.stats.aiAgreementRate !== null 
                          ? `${member.stats.aiAgreementRate}%` 
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
