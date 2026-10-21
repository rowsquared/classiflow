import { expect, test, type Page } from '@playwright/test'
import { ADMIN, RECORDS, WORKSPACE_ID } from './fixtures'
import { expectAccessible } from './a11y'

// axe-core on the main pages, read-only (the data journeys in
// journeys.spec.ts change records). Fails on serious/critical findings.

const pagePath = (path: string) => `/w/${WORKSPACE_ID}${path}`

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).toHaveURL(/\/queue/)
}

let cspReports: string[] = []
test.beforeEach(async ({ page }) => {
  cspReports = []
  page.on('console', msg => {
    if (msg.text().includes('Content Security Policy')) cspReports.push(msg.text())
  })
  await signIn(page)
})
test.afterEach(() => {
  expect(cspReports).toEqual([])
})

test('sign-in page', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await expect(page.getByLabel(/password/i)).toBeVisible()
  await expectAccessible(page, 'login')
  await context.close()
})

test('queue, with the filter panel and the workspace switcher open', async ({ page }) => {
  await expect(page.locator('tbody tr')).toHaveCount(RECORDS.length)
  await expectAccessible(page, 'queue')

  if ((await page.getByRole('heading', { name: 'Filters' }).count()) === 0) {
    await page.getByRole('button', { name: 'Toggle filters' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await expect(page.getByRole('listbox', { name: 'Assigned to' })).toBeVisible()
  await expectAccessible(page, 'queue filters')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Switch workspace/ }).click()
  await expect(page.getByRole('option', { name: /E2E workspace/ })).toBeVisible()
  await expectAccessible(page, 'workspace switcher')
})

test('labelling screen and its comments dialog', async ({ page }) => {
  await page.locator('tbody tr').filter({ hasText: RECORDS[1]! }).click()
  await expect(page.getByRole('button', { name: /^01\b/ })).toBeVisible()
  await expectAccessible(page, 'labelling')

  await page.keyboard.press('c')
  await expect(page.getByRole('dialog', { name: 'Comments' })).toBeVisible()
  await expectAccessible(page, 'comments')
})

test('taxonomy browser page', async ({ page }) => {
  await page.goto(pagePath('/taxonomies/ISCO'))
  await expect(page.getByText('Professionals').first()).toBeVisible()
  await expectAccessible(page, 'taxonomy')
})

test('progress', async ({ page }) => {
  await page.goto(pagePath('/progress'))
  await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible()
  await expectAccessible(page, 'progress')
})

test('team', async ({ page }) => {
  await page.goto(pagePath('/admin/team'))
  await expect(page.getByLabel('Search members')).toBeVisible()
  await expectAccessible(page, 'team')
})

test('audit log', async ({ page }) => {
  await page.goto(pagePath('/admin/audit'))
  await expect(page.getByLabel('Show')).toBeVisible()
  await expectAccessible(page, 'audit')
})

test('workspace chooser', async ({ page }) => {
  await page.goto('/workspaces')
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await expectAccessible(page, 'workspaces')
})
