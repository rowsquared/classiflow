import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSentences,
  createUser,
  createWorkspace,
  params,
  prisma,
  request,
  resetDatabase,
  signInAs
} from './helpers'
import { workspaceRoute } from '@/lib/api-auth'
import * as exportRoute from '@/app/api/workspaces/[workspaceId]/export/route'

// proxy.ts puts the request ID on the request headers; route handlers read it
// through next/headers, which only works inside a real request.
const REQUEST_ID = 'req-observability-0001'
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-request-id': REQUEST_ID })
}))

beforeEach(async () => {
  await resetDatabase()
  await createWorkspace()
  signInAs(await createUser('admin', { platformAdmin: true }))
})

describe('request IDs and unhandled errors', () => {
  it('records the request ID on audit entries', async () => {
    await createSentences(1)
    const res = await exportRoute.GET(request('/api/export'), params())
    expect(res.status).toBe(200)
    await res.text()
    const entry = await prisma.auditLog.findFirst({ where: { action: 'export.downloaded' } })
    expect(entry?.requestId).toBe(REQUEST_ID)
  })

  it('answers 500 without details when a workspace handler throws', async () => {
    const handler = workspaceRoute(['admin'], async () => {
      throw new Error('secret internal detail')
    })
    const res = await handler(request('/api/anything', { method: 'POST', body: {} }), params())
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain('secret internal detail')
    expect(JSON.parse(body)).toEqual({ error: 'Internal server error' })
  })
})
