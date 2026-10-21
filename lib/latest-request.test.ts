import { describe, expect, it } from 'vitest'
import { createLatestRequest, isAbortError } from './latest-request'

describe('createLatestRequest', () => {
  it('aborts the previous request and marks it stale', () => {
    const latest = createLatestRequest()
    const first = latest.start()
    const second = latest.start()

    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('a slow first response cannot win over a later one', async () => {
    const latest = createLatestRequest()
    const shown: string[] = []
    const load = async (value: string, delay: number) => {
      const req = latest.start()
      await new Promise(r => setTimeout(r, delay))
      if (req.isCurrent()) shown.push(value)
    }

    await Promise.all([load('old filter', 30), load('new filter', 5)])

    expect(shown).toEqual(['new filter'])
  })

  it('cancel aborts without starting a new request', () => {
    const latest = createLatestRequest()
    const req = latest.start()
    latest.cancel()
    expect(req.signal.aborted).toBe(true)
    expect(req.isCurrent()).toBe(false)
  })
})

describe('isAbortError', () => {
  it('recognises fetch aborts only', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await fetch('http://127.0.0.1:9', { signal: controller.signal }).catch(e => e)
    expect(isAbortError(error)).toBe(true)
    expect(isAbortError(new Error('HTTP 500'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
