'use client'

import { useState } from 'react'
import { formatRelativeTime } from '@/lib/utils'
import { workspaceApi } from '@/lib/workspace/urls'
import { mailStatusLabel } from '@/components/team/mail-status'

export type PendingInvitation = {
  id: string
  email: string
  role: 'admin' | 'supervisor' | 'labeller'
  expired: boolean
  expiresAt: string
  createdAt: string
  mailStatus: string | null
}

type Props = {
  invitations: PendingInvitation[]
  mailEnabled: boolean
  onChanged: (message: string) => void
  onError: (message: string) => void
}

/** Open invitations to this workspace, with resend and withdraw (workspace admins). */
export default function PendingInvitations({ invitations, mailEnabled, onChanged, onError }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  if (invitations.length === 0) return null

  const act = async (invitation: PendingInvitation, method: 'POST' | 'DELETE') => {
    setBusy(invitation.id)
    try {
      const res = await fetch(workspaceApi(`/invitations/${invitation.id}`), { method })
      if (!res.ok) {
        onError((await res.json().catch(() => ({}))).error || 'The change was refused')
        return
      }
      onChanged(method === 'POST' ? `Invitation to ${invitation.email} sent again` : 'Invitation withdrawn')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="pending-invitations" className="space-y-2">
      <h2 id="pending-invitations" className="text-sm font-medium text-gray-900">
        Open invitations
      </h2>
      <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
        {invitations.map(invitation => (
          <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="flex-1 min-w-48 text-gray-900">
              {invitation.email} <span className="text-gray-500 capitalize">· {invitation.role}</span>
            </span>
            <span className="text-gray-600" title={invitation.expiresAt}>
              {invitation.expired ? 'Expired' : `Sent ${formatRelativeTime(invitation.createdAt)}`}
              {invitation.mailStatus ? ` · ${mailStatusLabel(invitation.mailStatus)}` : ''}
            </span>
            {mailEnabled && (
              <button
                type="button"
                disabled={busy === invitation.id}
                onClick={() => act(invitation, 'POST')}
                className="text-indigo-700 underline disabled:opacity-50"
              >
                Resend
              </button>
            )}
            <button
              type="button"
              disabled={busy === invitation.id}
              onClick={() => act(invitation, 'DELETE')}
              className="text-red-700 underline disabled:opacity-50"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
