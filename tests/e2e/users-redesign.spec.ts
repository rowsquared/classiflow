import { expect, test } from '@playwright/test'
import { ADMIN, WORKSPACE_ADMIN, WORKSPACE_ID } from './fixtures'
import { expectAccessible } from './a11y'

async function signInPlatform(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/(?:queue|workspaces)$/)
}

test('a partial multi-workspace grant retries only the failed grant and keeps the account', async ({ page }) => {
  await signInPlatform(page)
  const stamp = Date.now()
  const workspaceName = `Retry workspace ${stamp}`
  const response = await page.request.post('/api/workspaces', { data: { name: workspaceName } })
  const { workspace } = await response.json()
  let accountCreates = 0,
    firstGrants = 0,
    attempts = 0
  page.on('request', req => {
    if (req.method() !== 'POST') return
    if (new URL(req.url()).pathname === '/api/users') accountCreates++
    if (new URL(req.url()).pathname === `/api/workspaces/${WORKSPACE_ID}/users`) firstGrants++
  })
  await page.route(`**/api/workspaces/${workspace.id}/users`, async route => {
    if (route.request().method() === 'POST' && ++attempts === 1)
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary grant failure' })
      })
    else await route.continue()
  })
  await page.goto(`/users?workspace=${WORKSPACE_ID}`)
  await page.getByRole('button', { name: 'Add user', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add user', exact: true })
  await add.getByLabel('Email', { exact: true }).fill(`retry-${stamp}@test.local`)
  await add.getByLabel('Name', { exact: true }).fill('Retry Person')
  await add.getByLabel('Show a temporary password').check()
  await add.getByLabel('Temporary password', { exact: true }).fill('copper-meadow-lantern-73')
  await add.getByRole('button', { name: 'Add another workspace' }).click()
  await add.getByRole('combobox', { name: 'Workspace', exact: true }).last().click()
  await page.getByRole('option', { name: workspaceName, exact: true }).click()
  await add.getByRole('button', { name: 'Add user', exact: true }).click()
  await expect(add.getByText('Temporary grant failure', { exact: false })).toBeVisible()
  await add.getByRole('button', { name: 'Retry failed grants' }).click()
  await expect(add.getByText('Temporary grant failure', { exact: false })).toHaveCount(0)
  expect(accountCreates).toBe(1)
  expect(firstGrants).toBe(1)
  expect(attempts).toBe(2)
})

test('a failed workspace switch never shows the previous workspace members under the new filter', async ({ page }) => {
  await signInPlatform(page)
  const name = `Empty view ${Date.now()}`
  const response = await page.request.post('/api/workspaces', { data: { name } })
  const { workspace } = await response.json()
  await page.goto(`/users?workspace=${WORKSPACE_ID}`)
  await expect(page.locator('tbody tr', { hasText: 'E2E Labeller' })).toBeVisible()
  await page.route('**/api/user-directory?**', async route => {
    if (new URL(route.request().url()).searchParams.get('workspace') === workspace.id) await route.abort()
    else await route.continue()
  })
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not refresh users' })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'E2E Labeller' })).toHaveCount(0)
})

test('workspace admins use the scoped editor and can invite without global account controls', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(WORKSPACE_ADMIN.username)
  await page.getByLabel(/password/i).fill(WORKSPACE_ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/(?:queue|workspaces)$/)
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Users', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp('/users\\?workspace=' + WORKSPACE_ID))
  await expectAccessible(page, 'workspace admin users')
  await page.getByRole('button', { name: 'Edit E2E Labeller', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspace access', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out everywhere', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0)
  await expectAccessible(page, 'workspace admin editor')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Add user', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add user', exact: true })
  await expect(add.getByLabel('Email a link to join the workspace')).toBeChecked()
  await expect(add.getByLabel('Show a temporary password')).toHaveCount(0)
  await add.getByLabel('Email', { exact: true }).fill('scoped-invite@test.local')
  await add.getByRole('button', { name: 'Add user', exact: true }).click()
  await expect(add.getByText('Invitation queued.', { exact: false })).toBeVisible()
})

test('global pages scroll within the shell and workspace deletion dialog is accessible', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/(?:queue|workspaces)$/)
  await page.setViewportSize({ width: 1100, height: 420 })
  await page.goto('/users')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  expect(await page.locator('main').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.locator('main').evaluate(el => {
    el.scrollTop = el.scrollHeight
  })
  expect(await page.locator('main').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await page.goto('/workspaces?status=all')
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
  expect(await page.locator('main').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.locator('main').evaluate(el => {
    el.scrollTop = el.scrollHeight
  })
  expect(await page.locator('main').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  const name = 'Accessible deletion ' + Date.now()
  const response = await page.request.post('/api/workspaces', { data: { name } })
  expect(response.ok()).toBe(true)
  const { workspace } = await response.json()
  await page.request.put('/api/workspaces/' + workspace.id, { data: { status: 'archived' } })
  await page.goto('/workspaces?status=archived&edit=' + workspace.id)
  await page.getByRole('button', { name: 'Delete workspace…', exact: true }).click()
  await expect(page.getByRole('textbox')).toBeVisible()
  await expectAccessible(page, 'delete workspace')
  await page.keyboard.press('Escape')
  await page.goto('/ai-services')
  await expect(page.getByRole('heading', { name: 'AI services', exact: true })).toBeVisible()
  await expectAccessible(page, 'AI services')
})
