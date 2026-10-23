import { expect, it } from 'vitest'
import { userDisplayName } from './user-display'

const username = 'user_5e86b12c7cb246938aa59128361d68c5'

it('shows the person name rather than the generated alias', () => {
  expect(userDisplayName({ name: 'Peter Brueckmann Test', email: 'peter@example.org', username })).toBe(
    'Peter Brueckmann Test'
  )
})

it('falls back to email when the name is missing or blank', () => {
  expect(userDisplayName({ name: '  ', email: 'peter@example.org', username })).toBe('peter@example.org')
})

it('never displays a generated alias when no name or email is available', () => {
  expect(userDisplayName({ username })).toBe('Unnamed user')
})

it('keeps a manually chosen username as a legacy fallback', () => {
  expect(userDisplayName({ username: 'peter' })).toBe('peter')
})
