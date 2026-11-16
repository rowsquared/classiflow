import { expect, test } from '@playwright/test'
import { ADMIN } from './fixtures'
import { api, seedBeforeAll } from './helpers'

seedBeforeAll()

test('record import dry run reads the whole 15 MiB CSV through the proxy', async ({ request }) => {
  const login = await request.post('/api/auth/sign-in/username', { data: ADMIN })
  expect(login.ok()).toBeTruthy()

  const rowCount = 15_360
  const csv = Buffer.from(`field_text\n${`${'a'.repeat(1023)}\n`.repeat(rowCount)}`)
  const response = await request.post(api('/sentences/import?dryRun=true'), {
    multipart: { file: { name: 'large-dry-run.csv', mimeType: 'text/csv', buffer: csv } }
  })
  expect(response.status(), await response.text()).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, dryRun: true, summary: { totalRows: rowCount } })
})
