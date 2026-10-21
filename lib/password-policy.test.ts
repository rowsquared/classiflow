import { describe, expect, it } from 'vitest'
import { passwordProblem } from './password-policy'

describe('passwordProblem', () => {
  it('accepts a long, unrelated password', () => {
    expect(passwordProblem('correct horse battery', { username: 'maria', email: 'maria@x.org', name: 'Maria Rossi' })).toBeNull()
  })

  it('enforces the length limits', () => {
    expect(passwordProblem('short-pw1')).toMatch(/at least 10/)
    expect(passwordProblem('x'.repeat(257))).toMatch(/at most 256/)
  })

  it('refuses common and repetitive passwords', () => {
    expect(passwordProblem('Password123')).toMatch(/too common/)
    expect(passwordProblem('abababababab')).toMatch(/different characters/)
  })

  it('refuses passwords containing the username, email name or name', () => {
    expect(passwordProblem('maria-2026!x', { username: 'maria' })).toMatch(/username/)
    expect(passwordProblem('the-rossi-house', { name: 'Maria Rossi' })).toMatch(/name/)
    expect(passwordProblem('jdoe-secret-99', { email: 'jdoe@example.org' })).toMatch(/email/)
  })

  it('ignores name parts too short to matter', () => {
    expect(passwordProblem('liberal-arts-77', { name: 'Li Wei' })).toBeNull()
  })
})
