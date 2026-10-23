import { expect, test } from '@playwright/test'
import { ADMIN, WORKSPACE_ID } from './fixtures'

// A platform admin approves an AI service; the workspace admin connects the
// workspace to it with a token that is never shown again, and turns AI on.
// No AI service runs here: nothing is sent until a job starts.

const TOKEN = 'e2e-taxomind-token'

let cspReports: string[] = []
test.beforeEach(({ page }) => {
  cspReports = []
  page.on('console', msg => {
    if (msg.text().includes('Content Security Policy')) cspReports.push(msg.text())
  })
})
test.afterEach(() => {
  expect(cspReports).toEqual([])
})

test('AI settings: approve a service, connect the workspace with a write-only token, turn AI on', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).toHaveURL(/\/queue$/)

  await page.goto('/ai-services')
  await page.getByLabel('Name', { exact: true }).last().fill('Test Taxomind')
  await page.getByLabel('Base URL').fill('https://taxomind.invalid/api/')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('(https://taxomind.invalid/api)')).toBeVisible()

  await page.goto(`/w/${WORKSPACE_ID}/admin/ai`)
  await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible()
  await expect(page.getByText('No connection yet.')).toBeVisible()
  await page.getByLabel('Access token').fill(TOKEN)
  await page.getByRole('button', { name: 'Save connection' }).click()
  await expect(page.getByText('stored (encrypted, not shown)')).toBeVisible()
  await expect(page.getByLabel('Access token')).toHaveValue('')
  await expect(page.getByText(`ai--${WORKSPACE_ID}`)).toBeVisible()

  await page.getByRole('button', { name: 'Turn on' }).click()
  await expect(page.getByText('AI turned on.')).toBeVisible()

  const settings = await page.request.get(`/api/workspaces/${WORKSPACE_ID}/ai-settings`)
  expect(await settings.text()).not.toContain(TOKEN)
  expect(await settings.json()).toMatchObject({ enabled: true, active: { version: 1, credentialStored: true } })
})
