'use client'

import { use, useState } from 'react'
import TaxonomyBrowser, { type SelectedLabel } from '@/components/TaxonomyBrowser'
import PageHeader from '@/components/PageHeader'
import { useActiveTaxonomies } from '@/components/labeling/data'
import { buttonClass, panelClass } from '@/components/ui/styles'

export default function TaxonomyPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const query = useActiveTaxonomies()
  const taxonomy = query.data?.find(t => t.key === key)
  const [labels, setLabels] = useState<SelectedLabel[]>([])
  return (
    <>
      <PageHeader title={`${key} taxonomy`} />
      <div className="p-6 max-w-5xl mx-auto">
        {query.isPending ? (
          <p role="status">Loading taxonomy…</p>
        ) : query.isError ? (
          <div role="alert">
            Could not load taxonomy.{' '}
            <button className={buttonClass('secondary')} onClick={() => query.refetch()}>
              Retry
            </button>
          </div>
        ) : taxonomy ? (
          <div className={panelClass}>
            <TaxonomyBrowser
              key={key}
              taxonomy={taxonomy}
              selectedLabels={labels.filter(l => l.taxonomyKey === key)}
              onLabelsChange={setLabels}
            />
          </div>
        ) : (
          <p role="alert">Taxonomy not found or inactive.</p>
        )}
      </div>
    </>
  )
}
