/**
 * Rules for every new password: account creation, admin-set temporary
 * passwords, self-service changes, password links and the admin scripts.
 * Existing passwords are not re-checked until they are next changed.
 * No imports, so scripts/*.ts can load this file directly.
 */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 256

// The most common passwords that pass the length rule; a short list on purpose.
const COMMON = new Set([
  '1234567890', '12345678910', 'qwertyuiop', 'password12', 'password123', 'password1234',
  'iloveyou12', 'abcdefghij', '0123456789', '1q2w3e4r5t', 'qwerty1234', 'asdfghjkl1',
  'changeme123', 'changeme1234', 'welcome123', 'letmein123', 'administrator', 'classiflow',
  'classiflow1', 'classiflow123', 'passwordpassword', 'aaaaaaaaaa', '1111111111',
])

export type PasswordContext = { username?: string | null; email?: string | null; name?: string | null }

/** Why `password` is not acceptable, or null when it is. */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`
  const folded = password.toLowerCase()
  if (COMMON.has(folded)) return 'This password is too common'
  if (new Set(folded).size < 4) return 'Use more different characters'
  const personal = [context.username, context.email?.split('@')[0], ...(context.name ?? '').split(/\s+/)]
    .map(part => (part ?? '').trim().toLowerCase())
    .filter(part => part.length >= 3)
  if (personal.some(part => folded.includes(part))) return 'Do not use your username, email or name in the password'
  return null
}
