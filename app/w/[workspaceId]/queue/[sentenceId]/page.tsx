'use client'
import { useParams, useSearchParams } from 'next/navigation'
import LabelingScreen from '@/components/labeling/LabelingScreen'

// The labelling screen for one record (components/labeling/). Keyed by the
// record, so moving to the next record starts from fresh state.
export default function LabelingPage() {
  const { sentenceId } = useParams<{ sentenceId: string }>()
  const listKey = useSearchParams().get('list')
  return <LabelingScreen key={sentenceId} sentenceId={sentenceId} listKey={listKey} />
}
