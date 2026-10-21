import { expect, test, type Page, type Route } from '@playwright/test'
import { parse } from 'csv-parse/sync'
import { ADMIN, RECORDS, WORKSPACE_ID } from './fixtures'

const api = (path: string) => `/api/workspaces/${WORKSPACE_ID}${path}`
const pagePath = (path: string) => `/w/${WORKSPACE_ID}${path}`

// The tests share one seeded database and run in this order: the labelling
// journey changes a record, which the export journey then reads.
test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, password = ADMIN.password) {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
}

const rows = (page: Page) => page.locator('tbody tr')

// The Content-Security-Policy is enforced (proxy.ts); any violation is logged
// to the console and fails the journey.
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
const isQueueRequest = (url: string) => new URL(url).pathname === api('/sentences')

test('sign-in refuses a wrong password and admits the right one', async ({ page }) => {
  await signIn(page, 'not-the-password')
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await expect(rows(page)).toHaveCount(RECORDS.length)
})

test.describe('queue', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await expect(rows(page)).toHaveCount(RECORDS.length)
  })

  test('typing a search sends one request, not one per keystroke', async ({ page }) => {
    const queries: string[] = []
    page.on('request', req => {
      if (isQueueRequest(req.url())) queries.push(new URL(req.url()).searchParams.get('q') ?? '')
    })

    await page.getByRole('textbox', { name: 'Search records' }).pressSequentially('nurse', { delay: 40 })

    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('hospital nurse')
    expect(queries).toEqual(['nurse'])
  })

  test('a slow, superseded search cannot overwrite the newer result', async ({ page }) => {
    // The first search is answered late, after the second one.
    let delayed = false
    await page.route(url => isQueueRequest(url.toString()), async (route: Route) => {
      if (!delayed && new URL(route.request().url()).searchParams.get('q') === 'nurse') {
        delayed = true
        await new Promise(r => setTimeout(r, 1500))
      }
      await route.continue().catch(() => { /* aborted by the page: expected */ })
    })
    const search = page.getByRole('textbox', { name: 'Search records' })

    await search.fill('nurse')
    await page.waitForTimeout(500) // debounce fires; the nurse request is in flight
    await search.fill('teacher')

    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('primary school teacher')
    await page.waitForTimeout(1800) // the late nurse response would land now
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('primary school teacher')
  })

  test('a failed refresh says so and keeps the last results; Retry recovers', async ({ page }) => {
    const queueUrl = (url: URL) => isQueueRequest(url.toString())
    const statsUrl = (url: URL) => url.pathname === api('/sentences/stats')
    await page.route(queueUrl, route => route.fulfill({ status: 500, body: '{}' }))
    await page.route(statsUrl, route => route.fulfill({ status: 500, body: '{}' }))

    await page.getByRole('textbox', { name: 'Search records' }).fill('developer')

    const banner = page.getByRole('alert').filter({ hasText: 'Could not load records' })
    await expect(banner).toBeVisible()
    await expect(rows(page)).toHaveCount(RECORDS.length) // not an empty "no records" list
    await expect(page.getByText('could not refresh, may be out of date')).toBeVisible()

    await page.unroute(queueUrl)
    await page.unroute(statsUrl)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(banner).toHaveCount(0)
    await expect(rows(page)).toHaveCount(1)
  })

  test('the assignment dialog keeps focus inside and closes on Escape', async ({ page }) => {
    await page.getByRole('checkbox', { name: `Select record: ${RECORDS[0]}` }).check()
    const open = page.getByRole('button', { name: /Assign \/ Unassign/ })
    await open.click()

    const dialog = page.getByRole('dialog', { name: 'Manage assignments' })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(open).toBeFocused()
  })
})

test('a record can be labelled with the keyboard and submitted', async ({ page }) => {
  await signIn(page)
  await rows(page).filter({ hasText: 'primary school teacher' }).click()
  await expect(page).toHaveURL(/\/queue\/[^/?]+/)
  const recordId = new URL(page.url()).pathname.split('/').pop()!

  await page.getByRole('button', { name: /^01\b/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /^011\b/ }).focus()
  await page.keyboard.press('Enter')

  // Enter on a label chooses it; it must not also submit the record.
  const before = await (await page.request.get(api(`/sentences/${recordId}`))).json()
  expect(JSON.stringify(before)).toContain('"status":"pending"')

  await page.getByRole('button', { name: /^Submit/ }).click()
  await expect.poll(async () => JSON.stringify(await (await page.request.get(api(`/sentences/${recordId}`))).json()))
    .toContain('"status":"submitted"')
})

test('the export contains the human label with its leading zero', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto(pagePath('/admin/export'))
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ])
  const csv = (await (await download.createReadStream()).toArray()).join('')
  expect(csv).toContain('primary school teacher')

  const records = parse(csv, { columns: true, bom: true }) as Array<Record<string, string>>
  const teacher = records.find(r => r.field_job_title === 'primary school teacher')
  expect(teacher).toMatchObject({ ISCO_1: '01', ISCO_2: '011', status: 'submitted' })
})

test('the audit log lists the export and can be filtered', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.getByRole('link', { name: 'Audit Log' }).click()

  await expect(page.getByRole('cell', { name: 'export.downloaded' })).toBeVisible()
  await page.getByLabel('Show').selectOption({ label: 'Users' })
  await expect(page.getByRole('cell', { name: 'export.downloaded' })).toHaveCount(0)
})

test('a comment can be added from the labelling page without triggering shortcuts', async ({ page }) => {
  await signIn(page)
  await rows(page).filter({ hasText: 'software developer' }).click()
  await expect(page).toHaveURL(/\/queue\/[^/?]+/)
  const recordId = new URL(page.url()).pathname.split('/').pop()!

  await page.keyboard.press('c')
  const dialog = page.getByRole('dialog', { name: 'Comments' })
  await expect(dialog).toBeVisible()
  // "s" (skip) and "f" (flag) are shortcuts outside the dialog; typing them here must not fire.
  await dialog.getByPlaceholder('Enter your comment...').fill('needs a second look: senior or junior?')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText('needs a second look: senior or junior?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  const record = JSON.stringify(await (await page.request.get(api(`/sentences/${recordId}`))).json())
  expect(record).toContain('"status":"pending"')
  expect(record).toContain('"flagged":false')
})

test('records can be imported from a CSV file with their ids kept', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto(pagePath('/admin/sentences'))

  await page.getByLabel('CSV file to import').setInputFiles({
    name: 'more.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,field_job_title,support_region\n0042,"baker, head",north\n'),
  })
  await page.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText('Successfully imported 1 sentences!')).toBeVisible()

  // The CSV id is kept as the record's key in this workspace.
  const res = await page.request.get(api('/sentences?q=baker'))
  expect(res.status()).toBe(200)
  const { sentences } = await res.json() as { sentences: Array<{ recordKey: string; field1: string }> }
  expect(sentences.map(s => [s.recordKey, s.field1])).toEqual([['0042', 'baker, head']])
})

test('team: add a member with a generated password, find, sort and remove them', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto(pagePath('/admin/team'))

  await page.getByRole('button', { name: 'Add member' }).click()
  await page.getByLabel('Username', { exact: true }).fill('e2e-new')
  await page.getByLabel('Email', { exact: true }).fill('e2e-new@test.local')
  await page.getByLabel('Name', { exact: true }).fill('Nova Member')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Member created' })).toBeVisible()
  await expect(page.getByText(/Username: e2e-new/)).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByLabel('Search members').fill('nova')
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Last seen' }).click()
  await expect(page.getByRole('columnheader', { name: /Last seen/ })).toHaveAttribute('aria-sort', 'ascending')

  await rows(page).first().getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Remove from workspace' }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText('e2e-new removed from this workspace')).toBeVisible()
  await expect(page.getByText('No members match these filters.')).toBeVisible()
})

test('platform admins see accounts with their workspaces', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
  const admin = page.locator('tbody tr', { hasText: ADMIN.username })
  await expect(admin).toContainText('Platform admin')
  await expect(admin).toContainText('E2E workspace: admin')
})
