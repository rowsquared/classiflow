import { describe, expect, it } from 'vitest'
import { SaveOperation } from './save-operation'

describe('SaveOperation', () => {
  it('reuses the id when the same payload is sent again after a failure', () => {
    const op = new SaveOperation()
    const first = op.idFor('r1:02')
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(op.idFor('r1:02')).toBe(first)
  })

  it('starts a new operation after success or for different labels', () => {
    const op = new SaveOperation()
    const first = op.idFor('r1:02')
    expect(op.idFor('r1:03')).not.toBe(first)
    const second = op.idFor('r1:03')
    op.succeeded()
    expect(op.idFor('r1:03')).not.toBe(second)
  })
})
