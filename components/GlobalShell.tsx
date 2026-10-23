'use client'
import type { ReactNode } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import Sidebar from '@/components/Sidebar'
import QueryProvider from '@/components/QueryProvider'
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher'

export default function GlobalShell({ scopeKey, children }: { scopeKey: string; children: ReactNode }) {
  return (
    <QueryProvider key={scopeKey}>
      <NuqsAdapter>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-white">
            <div className="sticky top-0 z-10 flex h-[66px] items-center justify-end border-b border-gray-200 bg-white px-8">
              <WorkspaceSwitcher />
            </div>
            {children}
          </main>
        </div>
      </NuqsAdapter>
    </QueryProvider>
  )
}
