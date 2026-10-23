type DisplayUser = { name?: string | null; email?: string | null; username?: string | null }

/** Generated legacy aliases are identifiers, not names to show to people. */
export function userDisplayName(user: DisplayUser): string {
  const name = user.name?.trim()
  if (name) return name
  const email = user.email?.trim()
  if (email) return email
  const username = user.username?.trim()
  if (username && !/^user_[a-f0-9]{32}$/i.test(username)) return username
  return 'Unnamed user'
}
