import { expect, test, type Page } from '@playwright/test'
import { WORKSPACE_ID } from './fixtures'
import { signIn } from './helpers'

// The queue's view lives in the URL (lib/queue-url.ts): reloading or sharing a
// link shows the same records, and back/forward step through the views.
// Read-only; runs after the data journeys, which submit records.

const rows = (page: Page) => page.locator('tbody tr')

test('search and tab survive a reload and back/forward', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('button', { name: /^Pending \(/ })).toHaveAttribute('aria-current', 'page')
  const pending = await rows(page).count()

  // The All tab, so the search finds the record whatever earlier journeys
  // submitted.
  await page.getByRole('button', { name: /^All \(/ }).click()
  await expect(page).toHaveURL(/[?&]tab=all/)
  await page.getByRole('textbox', { name: 'Search records' }).fill('nurse')
  await expect(page).toHaveURL(/[?&]q=nurse/)
  await expect(rows(page)).toHaveCount(1)

  // A shared link renders the same view on the server.
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('nurse')
  await expect(page.getByRole('button', { name: /^All \(/ })).toHaveAttribute('aria-current', 'page')
  await expect(rows(page)).toHaveCount(1)

  await page.goBack()
  await expect(page).not.toHaveURL(/tab=all/)
  await expect(page.getByRole('button', { name: /^Pending \(/ })).toHaveAttribute('aria-current', 'page')

  await page.goto(`/w/${WORKSPACE_ID}/queue`)
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('')
  await expect(rows(page)).toHaveCount(pending)
})

test('the workspace switcher is keyboard operable and names the role', async ({ page }) => {
  await signIn(page)
  const trigger = page.getByRole('button', { name: /Switch workspace/ })
  await expect(trigger).toContainText('E2E workspace')
  await expect(trigger).toContainText('admin')

  await trigger.focus()
  await page.keyboard.press('Enter')
  const search = page.getByRole('combobox', { name: 'Find a workspace' })
  await expect(search).toBeFocused()
  await search.fill('no such workspace')
  await expect(page.getByText('No workspace matches.')).toBeVisible()
  await search.fill('e2e')
  await expect(page.getByRole('option', { name: /E2E workspace/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('leaving the queue restores the last view while explicit links and reset take precedence', async ({ page }) => {
  await signIn(page)
  const queuePath = `/w/${WORKSPACE_ID}/queue`
  await page.goto(`${queuePath}?tab=all&q=nurse&flagged=false&limit=20`)
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('nurse')
  const sidebar = page.getByRole('complementary', { name: 'Main' })
  await sidebar.getByRole('link', { name: 'Progress', exact: true }).click()
  await sidebar.getByRole('link', { name: 'Queue', exact: true }).click()
  await expect(page).toHaveURL(/[?&]flagged=false/)
  expect(new URL(page.url()).searchParams.get('tab')).toBe('all')
  expect(new URL(page.url()).searchParams.get('limit')).toBe('20')
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('nurse')

  // A shared URL replaces the remembered filter rather than merging with it.
  await page.goto(`${queuePath}?tab=all&q=nurse`)
  expect(new URL(page.url()).searchParams.has('flagged')).toBe(false)
  await expect(rows(page)).toHaveCount(1)
  await rows(page).first().click()
  await page.getByRole('button', { name: /Back to queue/ }).click()
  await expect(page).toHaveURL(/[?&]q=nurse/)
  await expect(rows(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Toggle filters' }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('')
  await sidebar.getByRole('link', { name: 'Progress', exact: true }).click()
  await sidebar.getByRole('link', { name: 'Queue', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Search records' })).toHaveValue('')
  expect(new URL(page.url()).searchParams.has('q')).toBe(false)
  expect(new URL(page.url()).searchParams.has('flagged')).toBe(false)
})
