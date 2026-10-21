import { describe, expect, it } from 'vitest'
import { isWellFormedRequestId, requestIdFrom } from './request-id'

describe('request ids', () => {
  it('keeps a well-formed incoming id', () => {
    expect(requestIdFrom('req-0123456789abcdef')).toBe('req-0123456789abcdef')
    expect(requestIdFrom('2f1c9a4e-1b7d-4c4e-9d0e-8b8f2b2d0c11')).toBe('2f1c9a4e-1b7d-4c4e-9d0e-8b8f2b2d0c11')
  })

  it('replaces missing, short, long or odd ids with a new UUID', () => {
    const bad = [null, undefined, '', 'short', 'x'.repeat(129), 'has space 123', 'line\nbreak123', '<script>x</script>']
    for (const value of bad) {
      expect(isWellFormedRequestId(value)).toBe(false)
      expect(requestIdFrom(value)).toMatch(/^[0-9a-f-]{36}$/)
    }
  })
})
