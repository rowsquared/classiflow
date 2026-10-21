import { describe, expect, it } from 'vitest'
import openapi from './taxomind.openapi.json'
import { createdJobId, jobStatusResponse, parseLabelingResults, parseResponse, TaxomindContractError } from './taxomind'

const example = (name: keyof typeof openapi.components.schemas): unknown =>
  (openapi.components.schemas[name] as { example?: unknown }).example

describe('parseLabelingResults', () => {
  it('accepts only records of the job and well-formed suggestions', () => {
    const { bySentence, rejected, serviceErrors } = parseLabelingResults({
      suggestions: [
        { sentenceId: 'a', annotations: [{ level: 1, nodeCode: '01', confidence: 0.9 }, { level: 2, nodeCode: '011', confidence: 1.7 }] },
        { sentenceId: 'b', annotations: [{ level: 1, nodeCode: ' -9 ' }] },
        { sentenceId: 'not-in-job', annotations: [{ level: 1, nodeCode: '01' }] },
        { sentenceId: 'c', annotations: [{ level: 1, nodeCode: '01' }, { level: 1, nodeCode: '02' }] },
        { sentenceId: 'c', annotations: [] },
        { sentenceId: 'd', annotations: [{ level: 9, nodeCode: '01' }] },
        { sentenceId: 'd', annotations: [{ level: 1, nodeCode: 1 }] }, // codes are strings, never numbers
        { sentence_id: 'd', annotations: [{ level: 1, nodeCode: '01' }] }, // not the contract's key
        { sentenceId: 'd', annotations: [{ level: 1, nodeCode: '' }] },
        'garbage',
      ],
      errors: [{ sentenceId: 'e', error: 'empty text' }],
    }, ['a', 'b', 'c', 'd', 'e'])

    expect(Array.from(bySentence.keys())).toEqual(['a', 'b', 'c'])
    expect(bySentence.get('a')).toEqual([
      { level: 1, nodeCode: '01', confidence: 0.9 },
      { level: 2, nodeCode: '011', confidence: 1 },
    ])
    expect(bySentence.get('b')).toEqual([{ level: 1, nodeCode: '-9', confidence: 0 }])
    expect(bySentence.get('c')).toEqual([]) // duplicate level rejected, then empty list accepted
    expect(rejected).toBe(7)
    expect(serviceErrors).toBe(1)
  })

  it('handles a missing or malformed response', () => {
    expect(parseLabelingResults(null, ['a']).bySentence.size).toBe(0)
    expect(parseLabelingResults(undefined, ['a']).rejected).toBe(0)
    expect(parseLabelingResults({ suggestions: 'x', errors: 3 }, ['a'])).toMatchObject({ rejected: 0, serviceErrors: 0 })
  })

  it('reads Taxomind\'s documented example', () => {
    const result = (example('LabelingStatusResponse') as { result: unknown }).result
    const { bySentence, rejected } = parseLabelingResults(result, ['670ff0e7-d10e-430c-90e5-729a7e362ecc'])
    expect(rejected).toBe(0)
    expect(bySentence.get('670ff0e7-d10e-430c-90e5-729a7e362ecc')?.map(s => s.nodeCode)).toEqual(['2', '23', '234', '2341'])
  })
})

describe('job responses', () => {
  it('reads the job id of each documented creation response', () => {
    expect(createdJobId('label', example('LabelingJobResponse'))).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(createdJobId('learn', example('LearningJobResponse'))).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(createdJobId('taxonomies', example('TaxonomyJobResponse'))).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('rejects a creation response without the resource\'s id key', () => {
    expect(() => createdJobId('learn', { job_id: 'x' })).toThrow(TaxomindContractError)
    expect(() => createdJobId('label', { job_id: '' })).toThrow('Unexpected response from the AI service (POST /label): job_id')
    expect(() => createdJobId('taxonomies', null)).toThrow(TaxomindContractError)
  })

  it('reads each documented status response', () => {
    for (const name of ['LabelingStatusResponse', 'LearningStatusResponse', 'TaxonomyStatusResponse'] as const) {
      expect(parseResponse(jobStatusResponse, example(name), name)).toMatchObject({ status: 'completed' })
    }
  })

  it('rejects a status response without a known status', () => {
    for (const body of [{}, { status: 'done' }, { status: 'complete' }, 'completed', null]) {
      expect(() => parseResponse(jobStatusResponse, body, 'GET /label/x/status')).toThrow(TaxomindContractError)
    }
  })

  it('drops malformed informational fields instead of failing the poll', () => {
    expect(parseResponse(jobStatusResponse, { status: 'running', progress: 7, error: 42 }, 'GET /label/x/status'))
      .toEqual({ status: 'running', progress: null, error: null })
    expect(parseResponse(jobStatusResponse, { status: 'pending' }, 'GET /label/x/status')).toEqual({ status: 'pending' })
  })
})
