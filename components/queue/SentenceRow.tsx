'use client'
import { workspaceHref } from '@/lib/workspace/urls'
import { formatFieldName, formatRelativeTime, formatDateTime } from '@/lib/utils'
import { storeNavigationList } from '@/lib/labeling-navigation'
import { useRouter } from 'next/navigation'
import { CopyRecordLink } from '@/components/CopyRecordLink'
import { recordPath } from '@/lib/record-links'
import { useWorkspaceId } from '@/lib/workspace/urls'
import { MessageSquare } from 'lucide-react'
import { badgeClass, buttonClass } from '@/components/ui/styles'

// Custom AI suggestion icon
function SolidSparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.787 6.654l-2.895-1.03-1.081-3.403A.324.324 0 007.5 2c-.143 0-.27.09-.311.221l-1.08 3.404-2.897 1.03A.313.313 0 003 6.946c0 .13.085.248.212.293l2.894 1.03 1.082 3.507A.324.324 0 007.5 12c.144 0 .271-.09.312-.224L8.893 8.27l2.895-1.029A.313.313 0 0012 6.947a.314.314 0 00-.213-.293zM4.448 1.77l-1.05-.39-.39-1.05a.444.444 0 00-.833 0l-.39 1.05-1.05.39a.445.445 0 000 .833l1.05.389.39 1.051a.445.445 0 00.833 0l.39-1.051 1.05-.389a.445.445 0 000-.834z"
        fill="currentColor"
      />
    </svg>
  )
}

type Annotation = {
  id: string
  level: number
  nodeCode: string
  nodeLabel?: string | null
  source: 'user' | 'ai'
  taxonomy: {
    key: string
  }
  confidenceScore?: number
}

type Comment = {
  id: string
  body: string
  createdAt: string
  author: {
    name: string | null
  }
}

type Sentence = {
  id: string
  field1: string
  field2?: string | null
  field3?: string | null
  field4?: string | null
  field5?: string | null
  fieldMapping: Record<string, string>
  status: string
  flagged: boolean
  lastEditedAt: string | null
  lastEditor?: {
    name: string | null
    username: string | null
    email: string
  } | null
  assignments?: Array<{
    user: {
      id: string
      username: string
      name: string | null
    }
  }>
  annotations: Annotation[]
  comments?: Comment[]
  commentSummary?: { total: number; unresolved: number }
  _count?: {
    comments: number
  }
}

interface SentenceRowProps {
  sentence: Sentence
  selected: boolean
  onSelect: (checked: boolean) => void
  showAssignedTo?: boolean
  showStatus?: boolean
  contentWidthClass?: string
  labelWidthClass?: string
  taxonomies?: Array<{ key: string }> // Ordered list of taxonomies to match color order
  sentenceIds?: string[] // List of sentence IDs in current view (for navigation)
  currentIndex?: number // Current index in the list
}

export default function SentenceRow({
  sentence,
  selected,
  onSelect,
  showAssignedTo = false,
  showStatus = true,
  contentWidthClass = 'w-[40%]',
  labelWidthClass = 'w-[18%]',
  taxonomies = [],
  sentenceIds = [],
  currentIndex = 0
}: SentenceRowProps) {
  const router = useRouter()
  const workspaceId = useWorkspaceId() ?? ''

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking checkbox
    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
      return
    }

    // Store list and index in sessionStorage for navigation context
    // This avoids URL length limits (431 errors) and keeps URLs clean
    if (sentenceIds.length > 0) {
      const params = new URLSearchParams()
      params.set('list', storeNavigationList(sentenceIds, currentIndex))
      router.push(workspaceHref(`/queue/${sentence.id}?${params.toString()}`))
    } else {
      router.push(workspaceHref(`/queue/${sentence.id}`))
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return badgeClass('neutral')
      case 'submitted':
        return badgeClass('info')
      case 'skipped':
        return badgeClass('warn')
      default:
        return badgeClass('neutral')
    }
  }

  // Consistent colour per username, from the rowsquared pastels (black text on each)
  const getUserColor = (username: string) => {
    const colors = [
      'bg-[#75b8be] text-black',
      'bg-[#c997af] text-black',
      'bg-[#f4cf97] text-black',
      'bg-[#b9b0d3] text-black',
      'bg-[#65a6be] text-black',
      'bg-[#97b9a0] text-black',
      'bg-[#ecae5d] text-black',
      'bg-[#83a7b4] text-black',
      'bg-[#f6ddcd] text-black'
    ]

    // Simple hash function to get consistent color for each username
    let hash = 0
    for (let i = 0; i < username.length; i++) {
      hash = (hash << 5) - hash + username.charCodeAt(i)
      hash = hash & hash // Convert to 32bit integer
    }

    return colors[Math.abs(hash) % colors.length]
  }

  // Build content string with "Field Name: Value" format
  const buildContentString = () => {
    const parts: { name: string; value: string }[] = []

    // Iterate through field mapping in order
    Object.entries(sentence.fieldMapping || {}).forEach(([num, name]) => {
      const value = sentence[`field${num}` as keyof Sentence] as string | null
      if (value) {
        parts.push({ name: formatFieldName(name), value })
      }
    })

    return parts
  }

  const contentParts = buildContentString()

  // Group annotations by taxonomy
  const annotationsByTaxonomy = sentence.annotations.reduce(
    (acc, ann) => {
      const key = ann.taxonomy.key
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(ann)
      return acc
    },
    {} as Record<string, Annotation[]>
  )

  // Color scheme for different taxonomies (matches TaxonomyBrowser)
  const taxonomyColors = [
    'bg-[#D3F2EE] text-[#005c5c]', // Index 0: Primary/Teal
    'bg-[#E3EBFB] text-[#28498c]', // Index 1: Blue
    'bg-[#F6E4EC] text-[#6d2c4a]', // Index 2: Plum
    'bg-rose-100 text-rose-700', // Index 3: Rose fallback
    'bg-orange-100 text-orange-700' // Index 4: Orange fallback
  ]

  const getTaxonomyColor = (taxonomyKey: string) => {
    // Use the ordered taxonomies list if provided, otherwise fall back to alphabetical sort
    const orderedTaxonomies =
      taxonomies.length > 0 ? taxonomies.map(t => t.key) : Object.keys(annotationsByTaxonomy).sort()

    const index = orderedTaxonomies.indexOf(taxonomyKey)
    return taxonomyColors[index % taxonomyColors.length] || 'bg-gray-100 text-gray-700'
  }

  const summary = sentence.commentSummary ?? { total: 0, unresolved: 0 }

  return (
    <tr
      onClick={handleRowClick}
      className="hover:bg-[#e6fbf8] cursor-pointer transition-colors border-b border-gray-100"
    >
      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-12" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(e.target.checked)}
          aria-label={`Select record: ${sentence.field1}`}
          className="w-4 h-4 rounded border-gray-500 text-[#008080] focus-visible:ring-2 focus-visible:ring-[#008080] focus-visible:ring-offset-0 cursor-pointer"
        />
      </td>

      {/* Content */}
      <td className={`pl-0 pr-4 py-3 ${contentWidthClass}`}>
        <div className="flex items-stretch gap-2">
          {/* Icons at the beginning */}
          <div className="flex flex-col gap-1 self-stretch justify-center items-center flex-shrink-0 min-w-[20px]">
            {sentence.flagged && (
              <span className="text-[#F56476] cursor-help" title="Flagged">
                <svg className="w-4 h-4" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 2.2 L5.4 13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path
                    d="M5 3
                       C 8 1.5 10.5 3.5 13 2.5
                       L 13 10
                       C 10.5 11 8 9.5 5 10.5
                       Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            )}
          </div>

          {/* Field values with "Name Value" format */}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-900 line-clamp-2">
              {contentParts.map((part, i) => (
                <span key={i}>
                  {i > 0 && ' '}
                  <span className="text-[11px] font-medium text-gray-500">{part.name}</span> {part.value}
                </span>
              ))}
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className={buttonClass(summary.unresolved > 0 ? 'accent' : 'secondary', 'sm')}
          title={`${summary.unresolved} unresolved; ${summary.total - summary.unresolved} resolved comments`}
          onClick={() => {
            const params = new URLSearchParams({ comments: 'open' })
            if (sentenceIds.length) params.set('list', storeNavigationList(sentenceIds, currentIndex))
            router.push(`${recordPath(workspaceId, sentence.id)}?${params}`)
          }}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          Comments{summary.total > 0 ? ` · ${summary.unresolved}` : ''}
        </button>
        {summary.total > summary.unresolved && (
          <span className="block mt-1 text-xs text-gray-600">{summary.total - summary.unresolved} resolved</span>
        )}
      </td>
      <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
        <CopyRecordLink workspaceId={workspaceId} sentenceId={sentence.id} compact />
      </td>

      {/* Labels */}
      <td className={`px-4 py-3 ${labelWidthClass}`}>
        <div className="flex flex-col gap-1.5">
          {Object.keys(annotationsByTaxonomy).length > 0 ? (
            Object.entries(annotationsByTaxonomy).map(([taxonomyKey, annotations]) => (
              <div key={taxonomyKey} className="flex flex-wrap gap-1">
                {annotations.map((ann, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-0.5 rounded whitespace-nowrap flex items-center ${ann.source === 'ai' ? 'gap-0.5' : 'gap-1'} ${getTaxonomyColor(taxonomyKey)}`}
                    title={`${ann.taxonomy.key} L${ann.level}: ${ann.nodeCode}${
                      ann.nodeLabel ? ` - ${ann.nodeLabel}` : ''
                    }${ann.source === 'ai' && ann.confidenceScore !== undefined ? ` (AI confidence ${ann.confidenceScore.toFixed(2)})` : ''}`}
                  >
                    {ann.source === 'ai' && <SolidSparkle className="w-3 h-3" />}
                    {ann.nodeCode}
                  </span>
                ))}
              </div>
            ))
          ) : (
            <span className="text-gray-500 text-xs">—</span>
          )}
        </div>
      </td>

      {/* Last Edited */}
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
        <span title={formatDateTime(sentence.lastEditedAt)}>{formatRelativeTime(sentence.lastEditedAt)}</span>
      </td>

      {/* Last Editor */}
      <td className="px-4 py-3 whitespace-nowrap">
        {sentence.lastEditor?.username ? (
          <span
            className={badgeClass('plain', getUserColor(sentence.lastEditor.username))}
            title={sentence.lastEditor.username}
          >
            {sentence.lastEditor.username}
          </span>
        ) : (
          <span className="text-gray-500 text-sm">—</span>
        )}
      </td>

      {/* Assigned To */}
      {showAssignedTo && (
        <td className="px-4 py-3 whitespace-nowrap">
          {sentence.assignments && sentence.assignments.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {sentence.assignments.map((assignment, idx) => (
                <span
                  key={idx}
                  className={badgeClass('plain', getUserColor(assignment.user.username))}
                  title={assignment.user.name || assignment.user.username}
                >
                  {assignment.user.username}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-gray-500 text-sm">—</span>
          )}
        </td>
      )}

      {/* Status */}
      {showStatus && (
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={getStatusColor(sentence.status)}>{sentence.status}</span>
        </td>
      )}
    </tr>
  )
}
