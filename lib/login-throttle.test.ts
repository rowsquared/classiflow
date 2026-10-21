import { beforeEach, describe, expect, it } from 'vitest'
import { isLoginLocked, recordLoginFailure, recordLoginSuccess, resetLoginThrottle } from './login-throttle'

describe('login throttle', () => {
  beforeEach(() => resetLoginThrottle())

  it('locks an identifier after five failures and ignores case', () => {
    const t = 1_000_000
    for (let i = 0; i < 4; i++) recordLoginFailure('Alice', t)
    expect(isLoginLocked('alice', t)).toBe(false)
    recordLoginFailure('ALICE', t)
    expect(isLoginLocked('alice', t + 1)).toBe(true)
  })

  it('unlocks after the window and forgets old failures', () => {
    const t = 1_000_000
    for (let i = 0; i < 5; i++) recordLoginFailure('bob', t)
    expect(isLoginLocked('bob', t + 15 * 60 * 1000 + 1)).toBe(false)
    recordLoginFailure('bob', t + 15 * 60 * 1000 + 2)
    expect(isLoginLocked('bob', t + 15 * 60 * 1000 + 3)).toBe(false)
  })

  it('clears failures on success', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('carol')
    recordLoginSuccess('carol')
    recordLoginFailure('carol')
    expect(isLoginLocked('carol')).toBe(false)
  })
})
