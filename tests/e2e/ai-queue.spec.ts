import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { expectAccessible } from './a11y'
import { api, pagePath, seedBeforeAll, signIn } from './helpers'

seedBeforeAll()

test('sends a cross-page selection to AI and receives suggestions', async ({ page }) => {
  const started: Array<{ batchId: string; sentences: Array<{ sentence_id: string }> }> = []
  const server = createServer(async (req, res) => {
    const send = (code: number, value: object) =>
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    if (req.headers.authorization !== 'Bearer e2e-queue-token') return send(403, {})
    let raw = ''
    for await (const chunk of req) raw += chunk
    const created_at = new Date().toISOString()
    if (req.method === 'POST' && req.url === '/taxonomies') {
      return send(202, { job_id: 'sync', status: 'pending', message: 'Queued', created_at })
    }
    if (req.url === '/taxonomies/sync/status') return send(200, { job_id: 'sync', status: 'completed', created_at })
    if (req.method === 'POST' && req.url === '/label') {
      const job = JSON.parse(raw) as (typeof started)[number]
      started.push(job)
      return send(202, { job_id: 'label', batch_id: job.batchId, status: 'pending', message: 'Queued', created_at })
    }
    const job = started[0]
    if (job && req.url === '/label/label/status') {
      return send(200, {
        job_id: 'label',
        batch_id: job.batchId,
        status: 'completed',
        created_at,
        result: {
          batchId: job.batchId,
          suggestions: job.sentences.map(record => ({
            sentenceId: record.sentence_id,
            annotations: [{ level: 1, nodeCode: '02', confidence: 0.9 }]
          })),
          errors: []
        }
      })
    }
    return send(404, {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await signIn(page)
    const approved = await page.request.post('/api/ai-endpoints', {
      data: { name: 'Queue test service', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
    })
    expect(approved.status(), await approved.text()).toBe(201)
    const { endpoint } = await approved.json()
    const connected = await page.request.post(api('/ai-settings/connection'), {
      data: { endpointId: endpoint.id, credential: 'e2e-queue-token' }
    })
    expect(connected.status(), await connected.text()).toBe(201)
    expect((await page.request.put(api('/ai-settings'), { data: { enabled: true } })).status()).toBe(200)
    const sync = await page.request.post(api('/taxonomies/ISCO/sync-ai'))
    expect(sync.status(), await sync.text()).toBe(200)
    await expect
      .poll(async () => {
        const { taxonomies } = await (await page.request.get(api('/taxonomies/active'))).json()
        return taxonomies[0].lastAISyncStatus
      })
      .toBe('completed')

    await page.goto(pagePath('/queue?limit=1'))
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await page.getByRole('button', { name: 'Select all 3 matching records' }).click()
    await page.getByRole('link', { name: 'Send to AI' }).click()
    await expect(page.getByRole('heading', { name: 'Send to AI' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /ISCO/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /Skip records with suggestions/ })).toBeChecked()
    await page.getByRole('button', { name: 'Preview jobs' }).click()
    await expect(page.getByRole('row', { name: /^ISCO/ }).getByRole('cell')).toHaveText(['3', '0', '0', '1'])
    await expectAccessible(page, 'Send to AI preview')
    expect(started).toHaveLength(0)
    await page.getByRole('button', { name: 'Queue 1 AI job' }).click()
    await expect(page.getByText('Queued 1 AI job.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View AI jobs' })).toBeVisible()
    await expect
      .poll(async () => {
        const { pagination } = await (
          await page.request.get(api('/sentences?hasAISuggestions=true&status=pending'))
        ).json()
        return pagination.total
      })
      .toBe(3)
    expect(started).toHaveLength(1)
    expect(started[0]!.sentences).toHaveLength(3)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
