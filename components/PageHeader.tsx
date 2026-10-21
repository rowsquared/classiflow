import { ReactNode } from 'react'
import { HEADER_HEIGHT } from './Sidebar'
import AIJobStatusBadge from './AIJobStatusBadge'

interface PageHeaderProps {
  title: string
  actions?: ReactNode
}

export default function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div
      className="bg-white border-b border-gray-200 px-8 flex items-center justify-between sticky top-0 z-10"
      style={{ height: `${HEADER_HEIGHT}px` }}
    >
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-3">
        <AIJobStatusBadge />
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  )
}
