'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/PageHeader'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { formatDateTime } from '@/lib/utils'
import { workspaceApi } from '@/lib/workspace/urls'
import Modal from '@/components/Modal'
import { buttonClass, dialogPanelClass, panelClass } from '@/components/ui/styles'

type SentenceImport = {
  id: string
  fileName: string
  uploadedAt: string
  sentenceCount: number
}

type ImportPreview = { totalRows: number; emptyRecords: number; fieldColumns: string[]; supportColumns: string[] }
type DeletionPreview = { records: number; labelledRecords: number }

function importErrors(error: Error): string[] {
  if (error instanceof HttpError && typeof error.body === 'object' && error.body && 'errors' in error.body) {
    const errors = error.body.errors
    if (Array.isArray(errors) && errors.every(item => typeof item === 'string') && errors.length > 0) return errors
  }
  return [error.message]
}

export default function SentenceAdminClient({ initialImports }: { initialImports?: SentenceImport[] }) {
  const workspaceId = useWorkspaceInfo()?.id ?? ''
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [message, setMessage] = useState('')
  const [selectedImport, setSelectedImport] = useState<SentenceImport | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const importsQuery = useQuery({
    queryKey: queryKeys.imports(workspaceId),
    queryFn: async ({ signal }) =>
      (await fetchJson<{ imports: SentenceImport[] }>(workspaceApi('/imports'), { signal })).imports,
    initialData: initialImports
  })
  const deletion = useQuery({
    queryKey: [...queryKeys.imports(workspaceId), 'delete-preview', selectedImport?.id],
    queryFn: ({ signal }) => fetchJson<DeletionPreview>(workspaceApi(`/imports/${selectedImport!.id}`), { signal }),
    enabled: selectedImport !== null,
    staleTime: 0
  })

  async function refreshImports() {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.imports(workspaceId) }),
      client.invalidateQueries({ queryKey: queryKeys.queue(workspaceId) })
    ])
  }

  function clearFile() {
    setFile(null)
    setFileInputKey(key => key + 1)
    setPreview(null)
  }

  const upload = useMutation({
    mutationFn: async ({ csv, dryRun }: { csv: File; dryRun: boolean }) => {
      const body = new FormData()
      body.append('file', csv)
      return fetchJson<{ summary?: ImportPreview; count?: number }>(
        workspaceApi(`/sentences/import?dryRun=${dryRun}`),
        {
          method: 'POST',
          body
        }
      )
    },
    onSuccess: async (data, { dryRun }) => {
      if (dryRun && data.summary) {
        setPreview(data.summary)
      } else if (!dryRun) {
        setMessage(`Imported ${data.count?.toLocaleString()} records.`)
        clearFile()
        await refreshImports()
      }
    }
  })

  const deleteImport = useMutation({
    mutationFn: ({ id, labelledRecords }: { id: string; labelledRecords: number }) =>
      fetchJson<{ deletedSentences: number }>(
        workspaceApi(`/imports/${id}?confirmLabelledRecords=${labelledRecords}`),
        { method: 'DELETE' }
      ),
    onSuccess: async ({ deletedSentences }) => {
      setMessage(`Deleted the import and ${deletedSentences.toLocaleString()} records.`)
      setSelectedImport(null)
      await refreshImports()
    },
    onError: async error => {
      if (error instanceof HttpError && error.status === 409) {
        setConfirmation('')
        await deletion.refetch()
      }
    }
  })

  return (
    <>
      <PageHeader title="Records" />
      <div className="space-y-6 px-4 py-6 sm:px-8">
        {message && (
          <p role="status" className="text-sm text-green-800">
            {message}
          </p>
        )}
        <section className={`${panelClass} p-6`}>
          <h2 className="mb-4 text-lg font-semibold">Import records</h2>
          <div className="max-w-xl space-y-4">
            <label htmlFor="record-import-file" className="block text-sm font-medium">
              CSV file to import
            </label>
            <input
              key={fileInputKey}
              type="file"
              accept=".csv"
              id="record-import-file"
              disabled={upload.isPending}
              className="block max-w-full rounded-sm border border-gray-500 p-2 text-sm"
              onChange={event => {
                setFile(event.target.files?.[0] ?? null)
                setPreview(null)
                setMessage('')
                upload.reset()
              }}
            />
            <p className="text-sm text-gray-600">
              Use one to five <code>field_&lt;name&gt;</code> columns, up to five <code>support_&lt;name&gt;</code>{' '}
              columns, and an optional <code>id</code> column.
            </p>
            {upload.error && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-800">
                {importErrors(upload.error).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            )}
            {preview && (
              <div role="status" className="space-y-1 text-sm">
                <p>
                  <strong>{preview.totalRows.toLocaleString()} records ready to import</strong>
                </p>
                <p>Fields: {preview.fieldColumns.join(', ')}</p>
                {preview.supportColumns.length > 0 && <p>Context: {preview.supportColumns.join(', ')}</p>}
                {preview.emptyRecords > 0 && (
                  <p className="text-amber-800">
                    {preview.emptyRecords.toLocaleString()} records have no field values.
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => file && upload.mutate({ csv: file, dryRun: preview === null })}
                disabled={!file || upload.isPending}
                className={buttonClass('primary')}
              >
                {upload.isPending
                  ? preview
                    ? 'Importing…'
                    : 'Validating…'
                  : preview
                    ? `Import ${preview.totalRows.toLocaleString()} records`
                    : 'Validate CSV'}
              </button>
              {file && (
                <button
                  className={buttonClass('secondary')}
                  disabled={upload.isPending}
                  onClick={() => {
                    clearFile()
                    upload.reset()
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </section>
        <section className={`${panelClass} p-6`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Import history</h2>
            <button
              onClick={() => void importsQuery.refetch()}
              disabled={importsQuery.isFetching}
              className={buttonClass('secondary', 'sm')}
            >
              {importsQuery.isError ? 'Retry' : 'Refresh'}
            </button>
          </div>
          {importsQuery.isError && (
            <p role="alert" className="mb-4 text-sm text-red-800">
              Could not load import history.
            </p>
          )}
          {importsQuery.isPending && (
            <p role="status" className="text-sm text-gray-600">
              Loading imports…
            </p>
          )}
          {importsQuery.data?.length === 0 && !importsQuery.isError && (
            <p className="text-sm text-gray-600">No imports yet.</p>
          )}
          <ul className="divide-y divide-gray-200">
            {importsQuery.data?.map(record => (
              <li key={record.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{record.fileName}</p>
                  <p className="text-sm text-gray-600">
                    {formatDateTime(record.uploadedAt)} · {record.sentenceCount.toLocaleString()} records
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedImport(record)
                    setConfirmation('')
                    deleteImport.reset()
                  }}
                  className={buttonClass('secondary', 'sm')}
                  aria-label={`Delete import ${record.fileName}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selectedImport && (
        <Modal
          label="Delete import"
          onClose={() => {
            if (!deleteImport.isPending) setSelectedImport(null)
          }}
        >
          <div className={`${dialogPanelClass} w-full max-w-lg space-y-4 p-6`}>
            <h2 className="text-lg font-semibold">Delete import</h2>
            {deletion.isFetching && (
              <p role="status" className="text-sm">
                Loading deletion preview…
              </p>
            )}
            {deletion.isError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-red-800">
                  Could not load the deletion preview.
                </p>
                <button className={buttonClass('secondary', 'sm')} onClick={() => void deletion.refetch()}>
                  Retry
                </button>
              </div>
            )}
            {deletion.data && (
              <p className="text-sm text-gray-700">
                Deleting <strong>{selectedImport.fileName}</strong> permanently removes its{' '}
                {deletion.data.records.toLocaleString()} records, including{' '}
                {deletion.data.labelledRecords.toLocaleString()} labelled records and their labelling history.
              </p>
            )}
            {deleteImport.error && (
              <p role="alert" className="text-sm text-red-800">
                {deleteImport.error.message}
              </p>
            )}
            <label className="block text-sm">
              Type <strong>DELETE</strong> to confirm
              <input
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                disabled={deleteImport.isPending}
                className="mt-1 block w-full rounded-sm border border-gray-500 p-2"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                disabled={deleteImport.isPending}
                className={buttonClass('secondary')}
                onClick={() => setSelectedImport(null)}
              >
                Cancel
              </button>
              <button
                className={buttonClass('danger')}
                disabled={
                  confirmation !== 'DELETE' || !deletion.isSuccess || deletion.isFetching || deleteImport.isPending
                }
                onClick={() =>
                  deletion.data &&
                  deleteImport.mutate({ id: selectedImport.id, labelledRecords: deletion.data.labelledRecords })
                }
              >
                {deleteImport.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
