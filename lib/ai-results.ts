/**
 * Validation of a completed labeling job's result from the AI service.
 *
 * Only records that belong to the job are accepted (a response can never
 * overwrite suggestions of unrelated records). Per record: levels are integers
 * 1..5 and unique, codes are non-empty strings (numbers are accepted for
 * compatibility and stringified), confidence is clamped to 0..1. Anything else
 * is dropped and counted as rejected.
 */

export type ParsedSuggestion = { level: number; nodeCode: string; confidence: number }

type RawResponse = {
  suggestions?: unknown
  errors?: unknown
}

const MAX_CODE_LENGTH = 100

export function parseLabelingResults(
  raw: unknown,
  allowedSentenceIds: string[]
): { bySentence: Map<string, ParsedSuggestion[]>; rejected: number; serviceErrors: number } {
  const response = (raw && typeof raw === 'object' ? raw : {}) as RawResponse
  const allowed = new Set(allowedSentenceIds)
  const bySentence = new Map<string, ParsedSuggestion[]>()
  let rejected = 0

  const suggestions = Array.isArray(response.suggestions) ? response.suggestions : []
  for (const item of suggestions) {
    const s = (item && typeof item === 'object' ? item : {}) as {
      sentenceId?: unknown; sentence_id?: unknown; annotations?: unknown
    }
    const sentenceId = typeof s.sentenceId === 'string' ? s.sentenceId
      : typeof s.sentence_id === 'string' ? s.sentence_id : null
    if (!sentenceId || !allowed.has(sentenceId) || !Array.isArray(s.annotations) || bySentence.has(sentenceId)) {
      rejected++
      continue
    }

    const levels = new Set<number>()
    const parsed: ParsedSuggestion[] = []
    let valid = true
    for (const a of s.annotations as Array<Record<string, unknown>>) {
      const level = a?.level
      const code = typeof a?.nodeCode === 'string' ? a.nodeCode.trim()
        : typeof a?.nodeCode === 'number' && Number.isFinite(a.nodeCode) ? String(a.nodeCode) : ''
      if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 5 || levels.has(level)
        || !code || code.length > MAX_CODE_LENGTH) {
        valid = false
        break
      }
      levels.add(level)
      const c = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0
      parsed.push({ level, nodeCode: code, confidence: Math.min(Math.max(c, 0), 1) })
    }
    if (!valid) {
      rejected++
      continue
    }
    bySentence.set(sentenceId, parsed)
  }

  const serviceErrors = Array.isArray(response.errors) ? response.errors.length : 0
  return { bySentence, rejected, serviceErrors }
}
