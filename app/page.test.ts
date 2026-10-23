import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  cookie: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  }
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock('@/lib/server/page-user', () => ({ requirePageSession: async () => ({ id: 'user-1' }) }))
vi.mock('@/lib/server/workspaces', () => ({ listAccessibleWorkspaces: mocks.list }))

import HomePage from './page'

beforeEach(() => {
  mocks.cookie.mockReset()
  mocks.list.mockResolvedValue([
    { id: 'a', status: 'active' },
    { id: 'b', status: 'active' },
    { id: 'archived', status: 'archived' }
  ])
})

it('opens the first active workspace without a remembered workspace', async () => {
  await expect(HomePage()).rejects.toThrow('redirect:/w/a/queue')
})

it('returns to the last accessible active workspace', async () => {
  mocks.cookie.mockReturnValue({ value: 'user-1:b' })
  await expect(HomePage()).rejects.toThrow('redirect:/w/b/queue')
})

it.each(['user-1:archived', 'user-1:removed', 'other-user:b', 'malformed'])(
  'falls back when the preference is invalid: %s',
  async value => {
    mocks.cookie.mockReturnValue({ value })
    await expect(HomePage()).rejects.toThrow('redirect:/w/a/queue')
  }
)

it('keeps the chooser available when there are no active workspaces', async () => {
  mocks.list.mockResolvedValue([{ id: 'archived', status: 'archived' }])
  await expect(HomePage()).rejects.toThrow('redirect:/workspaces')
})
