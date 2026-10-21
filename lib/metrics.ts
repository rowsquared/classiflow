/**
 * AI agreement: of the human labels that have an AI suggestion for the same
 * record, taxonomy AND level, the share whose code matches.
 *
 * Suggestions are the current rows in SentenceAISuggestion (one per record,
 * taxonomy and level). There is no history, so a suggestion refreshed after the
 * person labelled is what gets compared, not the one they saw.
 */
type Label = { sentenceId: string; taxonomyId: string; level: number; nodeCode: string }

export function computeAgreement(humanLabels: Label[], suggestions: Label[]): { matches: number; total: number; rate: number | null } {
  const key = (l: Label) => `${l.sentenceId}\u0000${l.taxonomyId}\u0000${l.level}`
  const suggested = new Map(suggestions.map(s => [key(s), s.nodeCode]))
  let matches = 0
  let total = 0
  for (const label of humanLabels) {
    const code = suggested.get(key(label))
    if (code === undefined) continue
    total++
    if (code === label.nodeCode) matches++
  }
  return { matches, total, rate: total > 0 ? Math.round((matches / total) * 100) : null }
}
