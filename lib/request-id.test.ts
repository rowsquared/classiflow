import { describe, expect, it } from 'vitest'
import { isWellFormedRequestId } from './request-id'

describe('request ids', () => {
  it('recognizes well-formed request ids', () => {
    expect(isWellFormedRequestId('req-0123456789abcdef')).toBe(true)
    expect(isWellFormedRequestId('2f1c9a4e-1b7d-4c4e-9d0e-8b8f2b2d0c11')).toBe(true)
  })

  it('rejects missing, short, long or odd ids', () => {
    const bad = [null, undefined, '', 'short', 'x'.repeat(129), 'has space 123', 'line\nbreak123', '<script>x</script>']
    for (const value of bad) {
      expect(isWellFormedRequestId(value)).toBe(false)
    }
  })
})
