import { expect, test, type Page } from '@playwright/test'
import { ADMIN, WORKSPACE_ID } from './fixtures'

// The queue's view lives in the URL (lib/queue-url.ts): reloading or sharing a
// link shows the same records, and back/forward step through the views.
// Read-only; runs after journeys.spec.ts, which may have submitted records.

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).toHaveURL(/\/queue/)
}

const rows = (page: Page) => page.locator('tbody tr')

test('search and tab survive a reload and back/forward', async ({ page }) => {
  await signIn(page)
  await expect(rows(page).first()).toBeVisible()
  const pending = await rows(page).count()

  await page.getByRole('textbox', { name: 'Search records' }).fill('nurse')
  await expect(page).toHaveURL(/[?&]q=nurse/)
  await expect(rows(page)).toHaveCount(1)

  await page.getByRole('button', { name: /^All \(/ }).click()
  await expect(page).toHaveURL(/[?&]tab=all/)

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
