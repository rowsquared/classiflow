import { describe, expect, it } from 'vitest'
import { queuePreferenceCookie, queuePreferenceValue, rememberedQueueSearch } from './queue-preferences'

const user = { id: 'alice', role: 'admin' }

describe('remembered queue views', () => {
  it('round-trips filters, search, tab, page size and page with string codes', () => {
    const search = '?tab=all&q=nurse&taxonomyKey=ISCO&code=011&flagged=false&page=3&limit=20'
    const restored = new URLSearchParams(rememberedQueueSearch(queuePreferenceValue(user, search), user))
    expect(Object.fromEntries(restored)).toEqual({
      tab: 'all',
      q: 'nurse',
      taxonomyKey: 'ISCO',
      code: '011',
      flagged: 'false',
      page: '3',
      limit: '20'
    })
  })

  it('separates workspaces and does not restore another account or role', () => {
    expect(queuePreferenceCookie('workspace-a')).not.toBe(queuePreferenceCookie('workspace-b'))
    const saved = queuePreferenceValue(user, '?flagged=true')
    expect(rememberedQueueSearch(saved, { ...user, id: 'bob' })).toBe('')
    expect(rememberedQueueSearch(saved, { ...user, role: 'labeller' })).toBe('')
  })

  it('clearing the view replaces previously saved filters with the default', () => {
    expect(rememberedQueueSearch(queuePreferenceValue(user, ''), user)).toBe('')
    expect(rememberedQueueSearch(queuePreferenceValue(user, '?tab=pending&q=&page=1&limit=100'), user)).toBe('')
  })

  it.each([
    undefined,
    '',
    'broken',
    'null',
    '[]',
    JSON.stringify({ userId: 'alice', role: 'admin', search: 42 }),
    'x'.repeat(3501)
  ])('ignores invalid storage: %s', saved => {
    expect(rememberedQueueSearch(saved, user)).toBe('')
  })

  it('strips unknown parameters and normalizes invalid tab and page values', () => {
    const saved = queuePreferenceValue(
      user,
      '?next=https://example.org&list=private&tab=unknown&page=invalid&code=001'
    )
    expect(rememberedQueueSearch(saved, user)).toBe('?code=001')
  })
})
