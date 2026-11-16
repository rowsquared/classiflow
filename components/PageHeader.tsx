import { ReactNode } from 'react'
import { HEADER_HEIGHT } from './Sidebar'
import AIJobStatusBadge from './AIJobStatusBadge'
import WorkspaceSwitcher from './WorkspaceSwitcher'

interface PageHeaderProps {
  title: string
  actions?: ReactNode
}

export default function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div
      className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 lg:px-8"
      style={{ height: `${HEADER_HEIGHT}px` }}
    >
      <h1 className="min-w-0 truncate text-lg font-semibold text-gray-900 md:text-2xl">{title}</h1>
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <AIJobStatusBadge />
        {actions && <div className="flex items-center gap-3">{actions}</div>}
        <WorkspaceSwitcher />
      </div>
    </div>
  )
}
