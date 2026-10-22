import { expect, test, type Page } from '@playwright/test'
import { signIn, failOnCspViolations } from './helpers'
import { expectAccessible } from './a11y'

// Independent workspaces: these edge cases neither depend on nor change the journeys' records.
failOnCspViolations()
let workspaceId: string
let releases: Array<() => void> = []
const api = (path: string) => `/api/workspaces/${workspaceId}${path}`
const view = (path: string) => `/w/${workspaceId}${path}`

test.beforeEach(async ({ page }) => {
  workspaceId = ''
  releases = []
  await signIn(page)
  await expect(page).toHaveURL(/\/queue/)
  const response = await page.request.post('/api/workspaces', { data: { name: `Review ${test.info().title}` } })
  expect(response.status()).toBe(201)
  workspaceId = (await response.json()).workspace.id
})

test.afterEach(async ({ page }) => {
  releases.forEach(release => release())
  if (workspaceId) {
    const response = await page.request.put(api(''), { data: { status: 'archived' } })
    expect(response.status()).toBe(200)
  }
})

async function taxonomy(
  page: Page,
  key: string,
  csv = 'id,label,parent_id,level\n01,Group,,1\n011,Leaf,01,2\n02,Other leaf,,1'
) {
  const response = await page.request.post(api('/taxonomies'), {
    multipart: {
      key,
      maxDepth: '2',
      file: { name: `${key}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) }
    }
  })
  expect(response.status()).toBe(200)
}
async function records(page: Page, count = 1) {
  const csv = 'id,field_text\n' + Array.from({ length: count }, (_, i) => `${i + 1},Review record ${i + 1}`).join('\n')
  const response = await page.request.post(api('/sentences/import?dryRun=false'), {
    multipart: {
      file: { name: 'review.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
    }
  })
  expect(response.status()).toBe(200)
  return (await (await page.request.get(api('/sentences?sort=createdAt&order=asc'))).json()).sentences as Array<{
    id: string
    status: string
  }>
}

test('single labeling keeps drafts across tabs and visits unfinished taxonomies after an out-of-order save', async ({
  page
}) => {
  await taxonomy(page, 'A')
  await taxonomy(page, 'B')
  const [record] = await records(page)
  await page.goto(view(`/queue/${record!.id}`))
  await page.getByRole('button', { name: /^01\b/ }).click()
  await page.getByRole('button', { name: /^011\b/ }).click()
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await page.getByRole('button', { name: /^02\b/ }).click()
  await page.getByRole('button', { name: /^Submit/ }).click()
  await expect(page.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Remove label 011', exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/queue/${record!.id}$`))
  expect((await (await page.request.get(api(`/sentences/${record!.id}`))).json()).status).toBe('pending')
  await page.getByRole('button', { name: /^Submit/ }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/queue$`))
  expect((await (await page.request.get(api(`/sentences/${record!.id}`))).json()).status).toBe('submitted')
})

test('single flag and skip failures stay visible, modified shortcuts are ignored and an in-flight save blocks duplicates', async ({
  page
}) => {
  await taxonomy(page, 'A')
  const [record] = await records(page)
  const path = view(`/queue/${record!.id}`)
  await page.goto(path)
  await page.getByRole('button', { name: /^02\b/ }).click()
  await page.route(`**${api(`/sentences/${record!.id}/annotations`)}`, async route => {
    if (route.request().headers()['x-warmup']) return route.continue()
    await route.fulfill({ status: 500, json: { error: 'Save unavailable' } })
  })
  await page.getByRole('button', { name: /^Flag/ }).click()
  await expect(page.getByText('Failed to update flag. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Flag/ })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: /^Skip/ }).click()
  await expect(page.getByText('Failed to skip record. Please try again.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/queue/${record!.id}$`))
  await page.unrouteAll({ behavior: 'wait' })
  let requests = 0
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  releases.push(() => release())
  await page.route(`**${api(`/sentences/${record!.id}/annotations`)}`, async route => {
    requests++
    await held
    await route.continue()
  })
  await page.getByRole('heading', { name: 'Labeling', exact: true }).click()
  await page.keyboard.press('Control+Enter')
  expect(requests).toBe(0)
  await page.getByRole('button', { name: /^Submit/ }).click()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await page.keyboard.press('Enter')
  expect(requests).toBe(1)
  release()
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/queue$`))
})

test('bulk failures retain the selection, nested comment dialogs trap focus, and skips commit together', async ({
  page
}) => {
  await taxonomy(page, 'A')
  await records(page, 2)
  await page.goto(view('/queue'))
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Bulk label', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Bulk label', exact: true })
  await panel.getByRole('button', { name: 'Comment', exact: true }).click()
  const comment = page.getByRole('dialog', { name: 'Add comment', exact: true })
  await expect(comment.getByLabel('Comment for all selected sentences')).toBeVisible()
  await comment.getByLabel('Comment for all selected sentences').fill('Review comment')
  await comment.getByRole('button', { name: 'Save comment' }).focus()
  await page.keyboard.press('Tab')
  await expect(comment.getByLabel('Comment for all selected sentences')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(comment).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expectAccessible(page, 'bulk labeling')
  await page.route(`**${api('/sentences/bulk-label')}`, route =>
    route.fulfill({ status: 403, json: { error: 'Save refused' } })
  )
  await panel.getByRole('button', { name: 'Flag', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Flag', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await panel.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Save refused')
  expect(
    (await (await page.request.get(api('/sentences'))).json()).sentences.every(
      (r: { status: string }) => r.status === 'pending'
    )
  ).toBe(true)
  await page.unrouteAll({ behavior: 'wait' })
  await panel.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(panel).toHaveCount(0)
  expect(
    (await (await page.request.get(api('/sentences'))).json()).sentences.every(
      (r: { status: string }) => r.status === 'skipped'
    )
  ).toBe(true)
})

test('taxonomy pagination and search load complete paths even with more than 2,000 parents', async ({ page }) => {
  const csv = [
    'id,label,parent_id,level',
    ...Array.from({ length: 2101 }, (_, i) => `${String(i).padStart(5, '0')},Root ${i},,1`),
    'child,Deep leaf,02100,2'
  ].join('\n')
  await taxonomy(page, 'LARGE', csv)
  const [record] = await records(page)
  await page.goto(view(`/queue/${record!.id}`))
  await expect(page.getByRole('button', { name: /^00099\b/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^00100\b/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Load more labels' }).click()
  await expect(page.getByRole('button', { name: /^00100\b/ })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search LARGE' }).fill('Deep leaf')
  await page.getByRole('button', { name: /^child\b/ }).click()
  await expect(page.getByRole('button', { name: 'Remove label 02100' })).toBeVisible()
  await page.getByRole('button', { name: /^Submit/ }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/queue$`))
})

test('taxonomy errors offer retry instead of an empty taxonomy', async ({ page }) => {
  await taxonomy(page, 'A')
  await page.route(`**${api('/taxonomies/A/nodes')}?**`, route =>
    route.fulfill({ status: 500, json: { error: 'Unavailable' } })
  )
  await page.goto(view('/taxonomies/A'))
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load labels' })).toBeVisible()
  await page.unrouteAll({ behavior: 'wait' })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('button', { name: /^01\b/ })).toBeVisible()
})

test('selection across pages checks identities and select-all changes only the visible page', async ({ page }) => {
  await taxonomy(page, 'A')
  await records(page, 3)
  await page.goto(view('/queue?limit=1'))
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await expect(page.getByLabel('Select record: Review record 2')).toBeVisible()
  await expect(page.getByLabel('Select all records on this page')).not.toBeChecked()
  await page.getByLabel('Select all records on this page').check()
  await expect(page.getByText('2 sentences selected', { exact: true })).toBeVisible()
  await page.getByLabel('Select all records on this page').uncheck()
  await expect(page.getByText('1 sentence selected', { exact: true })).toBeVisible()
})

test('member import reports a failed request and cannot close while receiving generated passwords', async ({
  page
}) => {
  await page.goto(view('/admin/team'))
  await page.getByRole('button', { name: 'Import members' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import members' })
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'username,email,name,role,supervisor,access,password\nreview,review@test.local,Review,labeller,,generate,'
    )
  })
  await page.route(`**${api('/users/import')}?**`, route => route.abort())
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Could not reach the server')
  await page.unrouteAll({ behavior: 'wait' })
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Import 1 row' })).toBeEnabled()
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  releases.push(() => release())
  await page.route(`**${api('/users/import')}?dryRun=false`, async route => {
    await held
    await route.continue()
  })
  await dialog.getByRole('button', { name: 'Import 1 row' }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  release()
  await expect(dialog.getByText('Generated passwords are shown only now.', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download passwords (CSV)' })).toBeVisible()
})

test('mixed assignments can be completed for the whole selection', async ({ page }) => {
  await taxonomy(page, 'A')
  const selected = await records(page, 2)
  const user = await page.request.post(api('/users'), {
    data: {
      username: 'review-partial',
      email: 'partial@test.local',
      name: 'Partial Member',
      role: 'labeller',
      access: 'password',
      tempPassword: 'Review-only-password-123'
    }
  })
  expect(user.status()).toBe(201)
  const userId = (await user.json()).user.id
  expect(
    (
      await page.request.post(api('/sentences/assign'), { data: { sentenceIds: [selected[0]!.id], userIds: [userId] } })
    ).status()
  ).toBe(200)
  await page.goto(view('/queue'))
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Assign / unassign' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage assignments' })
  const member = dialog.getByRole('checkbox', { name: /Partial Member/ })
  await expect(member).toBeChecked({ indeterminate: true })
  await member.click()
  await dialog.getByRole('button', { name: 'Assign 1', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const result = await page.request.get(api(`/sentences/assign?sentenceIds=${selected.map(r => r.id).join(',')}`))
  expect((await result.json()).userAssignments[userId]).toHaveLength(2)
})

test('bulk labeling out of order still visits the remaining taxonomy', async ({ page }) => {
  await taxonomy(page, 'A')
  await taxonomy(page, 'B')
  await records(page, 2)
  await page.goto(view('/queue'))
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Bulk label', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Bulk label', exact: true })
  await dialog.getByRole('button', { name: 'B', exact: true }).click()
  await dialog.getByRole('button', { name: /^02\b/ }).click()
  await dialog.getByRole('button', { name: 'Submit (2)' }).click()
  await expect(dialog.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: /^02\b/ }).click()
  await dialog.getByRole('button', { name: 'Submit (2)' }).click()
  await expect(dialog).toHaveCount(0)
  expect(
    (await (await page.request.get(api('/sentences'))).json()).sentences.every(
      (r: { status: string }) => r.status === 'submitted'
    )
  ).toBe(true)
})

test('progress does not reuse old completion counts after labeling in the same workspace', async ({ page }) => {
  await taxonomy(page, 'A')
  await records(page, 2)
  await page.goto(view('/progress'))
  const complete = page.getByTestId('card-complete').locator('dd span').first()
  await expect(complete).toHaveText('0')
  await page.getByRole('link', { name: 'Queue', exact: true }).click()
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Bulk label', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Bulk label', exact: true })
  await dialog.getByRole('button', { name: /^02\b/ }).click()
  await dialog.getByRole('button', { name: 'Submit (2)' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('link', { name: 'Progress', exact: true }).click()
  await expect(complete).toHaveText('2')
})

test('assignment lookup remains within URL limits for a large selection', async ({ page }) => {
  test.setTimeout(60_000)
  await records(page, 601)
  const batches: number[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === api('/sentences/assign') && request.method() === 'GET')
      batches.push(url.searchParams.get('sentenceIds')!.split(',').length)
  })
  await page.goto(view('/queue?limit=9999'))
  await expect(page.getByLabel('Select record: Review record 601')).toBeVisible()
  await page.getByLabel('Select all records on this page').check()
  await page.getByRole('button', { name: 'Assign / unassign' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage assignments' })
  await expect(dialog.getByRole('checkbox', { name: /E2E Admin/ })).toBeVisible()
  expect(batches).toEqual([200, 200, 200, 1])
  await expect(dialog.getByText('Failed to load assignments', { exact: true })).toHaveCount(0)
})
