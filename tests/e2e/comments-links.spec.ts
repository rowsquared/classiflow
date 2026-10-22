import { expect, test } from '@playwright/test'
import { api, failOnCspViolations, pagePath, rows, signIn } from './helpers'
import { ADMIN, RECORDS } from './fixtures'
import { expectAccessible } from './a11y'

failOnCspViolations()
test.beforeEach(async ({ page }) => {
  await signIn(page)
  await expect(rows(page)).toHaveCount(RECORDS.length)
})

test('queue opens discussion, counts refresh, drafts survive collapse, and Back/Forward restore discussion', async ({
  page
}) => {
  await page.screenshot({ path: 'test-results/comments-queue.png', fullPage: true })
  const row = rows(page).filter({ hasText: RECORDS[1]! })
  await row.getByRole('button', { name: /^Comments/ }).click()
  await expect(page).toHaveURL(/comments=open/)
  const discussion = page.getByRole('region', { name: 'Comments', exact: true })
  const composer = discussion.getByLabel('Add new comment')
  await expect(composer).toBeFocused()
  await page.screenshot({ path: 'test-results/comments-inline.png', fullPage: true })
  await composer.fill('A draft for review')
  await discussion.getByRole('button', { name: 'Close comments' }).click()
  await expect(discussion).toHaveCount(0)
  await page.getByRole('button', { name: /^Comments/ }).click()
  await expect(composer).toHaveValue('A draft for review')
  await discussion.getByRole('button', { name: 'Save comment', exact: true }).click()
  const comment = discussion.getByRole('listitem').filter({ hasText: 'A draft for review' })
  await expect(comment).toBeVisible()
  await expect(page.getByRole('button', { name: /^Comments/ })).toContainText('1')
  await comment.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(comment).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Comments/ })).toContainText('0')
  await discussion.getByRole('button', { name: 'Show resolved' }).click()
  await comment.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByRole('button', { name: /^Comments/ })).toContainText('1')
  await comment.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(comment).toHaveCount(0)
  await discussion.getByRole('button', { name: 'Close comments' }).click()
  await page.goBack()
  await expect(discussion).toBeVisible()
  await page.goForward()
  await expect(discussion).toHaveCount(0)
})

test('record and discussion copy actions produce stable links that work without a navigation list', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const row = rows(page).filter({ hasText: RECORDS[0]! })
  await row.getByRole('button', { name: 'Copy link', exact: true }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(link).search).toBe('')
  await expect(page).toHaveURL(/\/queue$/)
  await row.click()
  await expect(page).toHaveURL(/\/queue\/[^/?]+/)
  const recordPath = new URL(page.url()).pathname
  expect(new URL(link).pathname).toBe(recordPath)
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  await page.keyboard.press('c')
  await page.getByRole('button', { name: 'Copy discussion link' }).click()
  const discussionLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(discussionLink).toBe(`${link}?comments=open`)
  const freshTab = await context.newPage()
  await freshTab.goto(discussionLink)
  await expect(freshTab.getByRole('region', { name: 'Comments', exact: true })).toBeVisible()
  await expect(freshTab.getByText('Sentence navigation unavailable')).toBeVisible()
  await freshTab.close()
})

test('small screens use an accessible dialog, preserve drafts on resize and handle clipboard failure', async ({
  page
}) => {
  await rows(page).filter({ hasText: RECORDS[1]! }).click()
  await page.setViewportSize({ width: 700, height: 850 })
  await page.keyboard.press('c')
  const dialog = page.getByRole('dialog', { name: 'Comments', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Add new comment').fill('Keep this draft')
  await page.screenshot({ path: 'test-results/comments-mobile.png', fullPage: true })
  await expectAccessible(page, 'mobile comments')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press('c')
  await expect(dialog.getByLabel('Add new comment')).toHaveValue('Keep this draft')
  await page.setViewportSize({ width: 1280, height: 850 })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Comments', exact: true }).getByLabel('Add new comment')).toHaveValue(
    'Keep this draft'
  )
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('blocked')
        }
      }
    })
  })
  await page.getByRole('button', { name: 'Copy discussion link' }).click()
  await expect(page.getByLabel('Link to copy')).toHaveValue(/\?comments=open$/)
  await page.getByLabel('Link to copy').focus()
  expect(
    await page.getByLabel('Link to copy').evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)
  ).toBeGreaterThan(0)
  const id = new URL(page.url()).pathname.split('/').pop()!
  const record = await (await page.request.get(api(`/sentences/${id}`))).json()
  expect(record.flagged).toBe(false)
  await page.goto(pagePath('/queue'))
})

test('a failed thread load offers retry instead of an empty discussion', async ({ page }) => {
  let fail = true
  await page.route('**/sentences/*/comments?*', async route => {
    if (fail) await route.fulfill({ status: 500, json: { error: 'Unavailable' } })
    else await route.continue()
  })
  await rows(page)
    .filter({ hasText: RECORDS[1]! })
    .getByRole('button', { name: /^Comments/ })
    .click()
  const discussion = page.getByRole('region', { name: 'Comments', exact: true })
  await expect(discussion.getByRole('alert')).toContainText('Could not load comments', { timeout: 15000 })
  await expect(discussion.getByText('No unresolved comments yet.')).toHaveCount(0)
  fail = false
  await discussion.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(discussion.getByRole('alert')).toHaveCount(0)
  await expect(discussion.getByText('No unresolved comments yet.')).toBeVisible()
})

test('a record refresh updates the badge while discussion is collapsed', async ({ page }) => {
  await rows(page)
    .filter({ hasText: RECORDS[1]! })
    .getByRole('button', { name: /^Comments/ })
    .click()
  const discussion = page.getByRole('region', { name: 'Comments', exact: true })
  await expect(discussion.getByText('No unresolved comments yet.')).toBeVisible()
  await discussion.getByRole('button', { name: 'Close comments' }).click()
  const id = new URL(page.url()).pathname.split('/').pop()!
  const response = await page.request.post(api(`/sentences/${id}/comments`), { data: { body: 'Added in another tab' } })
  expect(response.ok()).toBe(true)
  const { comment } = await response.json()
  try {
    const refresh = page.waitForResponse(
      r => new URL(r.url()).pathname === api(`/sentences/${id}`) && r.request().method() === 'GET'
    )
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await refresh
    await expect(page.getByRole('button', { name: /^Comments/ })).toContainText('1')
  } finally {
    await page.request.delete(api(`/sentences/${id}/comments`), { data: { commentId: comment.id } })
  }
})

test('a signed-out colleague returns to the shared discussion after signing in', async ({ page, browser }) => {
  await rows(page)
    .filter({ hasText: RECORDS[0]! })
    .getByRole('button', { name: /^Comments/ })
    .click()
  await expect(page).toHaveURL(/comments=open/)
  const target = new URL(page.url())
  target.searchParams.delete('list')
  const context = await browser.newContext()
  try {
    const colleague = await context.newPage()
    await colleague.goto(target.href)
    await expect(colleague).toHaveURL(/\/login\?next=/)
    await colleague.getByLabel(/username or email/i).fill(ADMIN.username)
    await colleague.getByLabel(/password/i).fill(ADMIN.password)
    await colleague.getByRole('button', { name: /sign in|log in/i }).click()
    await expect(colleague).toHaveURL(target.href)
    await expect(colleague.getByRole('region', { name: 'Comments', exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})
