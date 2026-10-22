'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import { buttonClass } from '@/components/ui/styles'

type TimeZoneDialogProps = {
  current: string
  /** Saves the zone (null: the deployment default); resolves to an error message or null. */
  onSave: (timeZone: string | null) => Promise<string | null>
  onClose: () => void
}

const zones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

/** Workspace admins choose the reporting time zone (calendar days and Monday weeks). */
export default function TimeZoneDialog({ current, onSave, onClose }: TimeZoneDialogProps) {
  const [options] = useState(() => ['UTC', ...zones().filter(z => z !== 'UTC')])
  const [zone, setZone] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (value: string | null) => {
    setSaving(true)
    const message = await onSave(value)
    setSaving(false)
    if (message) setError(message)
    else onClose()
  }

  return (
    <Modal label="Reporting time zone" onClose={onClose} closeOnOverlayClick>
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Reporting time zone</h2>
        <p className="mt-1 text-sm text-gray-600">
          Progress counts calendar days and Monday weeks in this time zone, for everyone in this workspace.
        </p>
        {/* A native select: long, but type-ahead finds a zone and it needs no popup inside the dialog. */}
        <label className="mt-4 block text-sm text-gray-700">
          Time zone
          <select
            value={zone}
            onChange={e => setZone(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-500 px-2 py-1.5 text-sm text-gray-900"
          >
            {!options.includes(current) && <option value={current}>{current}</option>}
            {options.map(z => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => save(null)}
            disabled={saving}
            className="mr-auto rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Use the deployment default
          </button>
          <button type="button" onClick={onClose} className={buttonClass('secondary', 'sm')}>
            Cancel
          </button>
          <button type="button" onClick={() => save(zone)} disabled={saving} className={buttonClass('primary', 'sm')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
