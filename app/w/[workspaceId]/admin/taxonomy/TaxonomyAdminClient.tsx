'use client'

import { useState } from 'react'
import PageHeader from '@/components/PageHeader'
import CreateTaxonomyDialog from '@/components/taxonomy-admin/CreateTaxonomyDialog'
import DeleteTaxonomyDialog from '@/components/taxonomy-admin/DeleteTaxonomyDialog'
import EditTaxonomyDialog from '@/components/taxonomy-admin/EditTaxonomyDialog'
import TaxonomyCard from '@/components/taxonomy-admin/TaxonomyCard'
import { MAX_ACTIVE_TAXONOMIES, type Message, type Taxonomy } from '@/components/taxonomy-admin/types'
import { useTaxonomyAdmin } from '@/components/taxonomy-admin/useTaxonomyAdmin'

export type { Taxonomy } from '@/components/taxonomy-admin/types'

type Props = {
  initialTaxonomies: Taxonomy[]
  initialLearningThreshold: number
}

type Dialog = { kind: 'create' } | { kind: 'edit'; taxonomy: Taxonomy } | { kind: 'delete'; taxonomy: Taxonomy } | null

/**
 * Taxonomy administration: the workspace's taxonomies (at most three) with
 * create, edit (including replacing nodes), delete, and the AI sync and
 * learning actions. Data and polling: useTaxonomyAdmin; dialogs and cards in
 * components/taxonomy-admin/.
 */
export default function TaxonomyAdminClient({ initialTaxonomies, initialLearningThreshold }: Props) {
  const { taxonomies, learningThreshold, loadFailed, refresh, refreshAIJobs } = useTaxonomyAdmin({
    taxonomies: initialTaxonomies,
    learningThreshold: initialLearningThreshold
  })
  const [message, setMessage] = useState<Message | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const canAddNew = taxonomies.length < MAX_ACTIVE_TAXONOMIES
  const closeDialog = () => setDialog(null)
  const succeeded = (text: string) => {
    setMessage({ type: 'success', text })
    setDialog(null)
    void refresh()
  }

  return (
    <>
      <PageHeader title="Taxonomies" />

      <div className="px-8 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm text-gray-600">
                Import and manage hierarchical taxonomies for labeling (max {MAX_ACTIVE_TAXONOMIES} active)
              </p>
              {!canAddNew && (
                <p className="text-sm text-orange-700 mt-2">
                  ⚠️ Maximum active taxonomies reached. Delete one to add a new taxonomy.
                </p>
              )}
            </div>
            <button
              onClick={() => setDialog({ kind: 'create' })}
              disabled={!canAddNew}
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add New Taxonomy
            </button>
          </div>
        </div>

        {message && (
          <div
            role={message.type === 'error' ? 'alert' : 'status'}
            className={`mb-6 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <div className="whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">{message.text}</div>
          </div>
        )}
        {loadFailed && (
          <p role="alert" className="mb-6 text-sm text-red-700">
            The taxonomies could not be refreshed; the list may be out of date.
          </p>
        )}

        <div className="space-y-6 mb-12">
          {taxonomies.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-600">No active taxonomies. Click &quot;Add New Taxonomy&quot; to create one.</p>
            </div>
          ) : (
            taxonomies.map(taxonomy => (
              <TaxonomyCard
                key={taxonomy.id}
                taxonomy={taxonomy}
                learningThreshold={learningThreshold}
                onEdit={t => {
                  setMessage(null)
                  setDialog({ kind: 'edit', taxonomy: t })
                }}
                onDelete={t => setDialog({ kind: 'delete', taxonomy: t })}
                onMessage={setMessage}
                onJobStarted={() => {
                  void refresh()
                  void refreshAIJobs()
                }}
              />
            ))
          )}
        </div>
      </div>

      {dialog?.kind === 'create' && <CreateTaxonomyDialog onClose={closeDialog} onCreated={succeeded} />}
      {dialog?.kind === 'edit' && (
        <EditTaxonomyDialog
          taxonomy={dialog.taxonomy}
          onClose={closeDialog}
          onSaved={succeeded}
          onMessage={setMessage}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteTaxonomyDialog
          taxonomy={dialog.taxonomy}
          onClose={closeDialog}
          onDeleted={succeeded}
          onMessage={setMessage}
        />
      )}
    </>
  )
}
