import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, HttpError, shouldRetry } from './fetch'

afterEach(() => vi.unstubAllGlobals())

describe('fetchJson', () => {
  it('returns the parsed body and passes the signal through', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await expect(fetchJson('/x', { signal: controller.signal })).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/x', { signal: controller.signal })
  })

  it('throws an HttpError with the status and the server message', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    const error = await fetchJson('/x').catch(e => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 403, message: 'Forbidden' })
  })

  it('copes with a body that is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('oops', { status: 502 }))
    await expect(fetchJson('/x')).rejects.toMatchObject({ status: 502, message: 'Request failed with status 502' })
  })
})

describe('shouldRetry', () => {
  it('retries a server or network failure once, never a client error', () => {
    expect(shouldRetry(0, new HttpError(500, null))).toBe(true)
    expect(shouldRetry(1, new HttpError(500, null))).toBe(false)
    expect(shouldRetry(0, new TypeError('network'))).toBe(true)
    expect(shouldRetry(0, new HttpError(404, null))).toBe(false)
  })
})
