import { expect, test, type Page } from '@playwright/test'
import { ADMIN } from './fixtures'
import { api, failOnCspViolations, pagePath, signIn } from './helpers'
import { expectAccessible } from './a11y'

// The Progress dashboard (docs/plans/progress-dashboard.md): the view lives in
// the URL, sections load and fail independently, filters narrow the scope.
// Runs after journeys.spec.ts and labelling-bulk.spec.ts, so the admin has
// labeled records today. Adds a supervisor with one labeller (no records),
// which later files do not depend on; changes no records.

failOnCspViolations()

const SUPERVISOR = { username: 'e2e-progress-sup', name: 'Progress Supervisor' }
const LABELLER = { username: 'e2e-progress-lab', name: 'Progress Labeller' }

type Member = { id: string; username: string }

async function members(page: Page): Promise<Member[]> {
  return ((await (await page.request.get(api('/users?includeSuspended=1'))).json()) as { users: Member[] }).users
}

/** A small team for the filters, created once through the API. */
async function ensureTeam(page: Page) {
  let all = await members(page)
  if (!all.some(m => m.username === SUPERVISOR.username)) {
    const create = (body: Record<string, unknown>) =>
      page.request.post(api('/users'), {
        data: { access: 'password', tempPassword: 'Quiet-harbour-71-lamp', ...body }
      })
    const sup = await create({ ...SUPERVISOR, email: 'progress-sup@test.local', role: 'supervisor' })
    expect(sup.status()).toBe(201)
    const supId = ((await sup.json()) as { user: { id: string } }).user.id
    const lab = await create({ ...LABELLER, email: 'progress-lab@test.local', role: 'labeller', supervisorId: supId })
    expect(lab.status()).toBe(201)
    all = await members(page)
  }
  const id = (username: string) => all.find(m => m.username === username)!.id
  return { admin: id(ADMIN.username), supervisor: id(SUPERVISOR.username), labeller: id(LABELLER.username) }
}

const card = (page: Page, testId: string) => page.getByTestId(testId).locator('dd span').first()

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue/)
})

test('shows workload and activity; the period survives reload and back/forward', async ({ page }) => {
  const reports: number[] = []
  page.on('response', async response => {
    if (/\/progress\/(overview|activity|people)/.test(response.url())) {
      reports.push((await response.body()).length)
    }
  })
  await page.goto(pagePath('/progress'))
  await expect(page.getByRole('heading', { name: 'Workload now and activity' })).toBeVisible()
  await expect(card(page, 'card-total')).toHaveText(/^\d+$/)
  expect(Number(await card(page, 'card-labeled').textContent())).toBeGreaterThan(0)
  await expect(page.getByTestId('activity-chart')).toBeVisible()
  await expect(page.getByTestId('people-table')).toBeVisible()
  // The server rendered all three sections: mounting fetched nothing again.
  expect(reports).toEqual([])

  await page.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page).toHaveURL(/[?&]days=30/)
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true')
  await page.goBack()
  await expect(page).not.toHaveURL(/days=30/)
  await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true')

  // Reports are aggregates: no response comes near record-list size.
  expect(reports.length).toBeGreaterThan(0)
  for (const bytes of reports) expect(bytes).toBeLessThan(100_000)
})

test('a custom range applies only through Apply and refuses reversed dates', async ({ page }) => {
  await page.goto(pagePath('/progress'))
  await page.getByRole('button', { name: 'Custom dates' }).click()
  const form = page.getByRole('form', { name: 'Custom dates' })
  await form.getByLabel('From').fill('2026-02-10')
  await form.getByLabel('To').fill('2026-02-01')
  await form.getByRole('button', { name: 'Apply' }).click()
  await expect(form.getByRole('alert')).toContainText('must not be after')
  await expect(page).not.toHaveURL(/startDate/)

  await form.getByLabel('From').fill('2026-02-01')
  await form.getByLabel('To').fill('2026-02-10')
  await form.getByRole('button', { name: 'Apply' }).click()
  await expect(page).toHaveURL(/startDate=2026-02-01&endDate=2026-02-10|endDate=2026-02-10.*startDate=2026-02-01/)
  await expect(page.getByTestId('report-range')).toContainText('1 Feb 2026 – 10 Feb 2026')
  // A shared link renders the same range on the server.
  await page.reload()
  await expect(page.getByTestId('report-range')).toContainText('1 Feb 2026 – 10 Feb 2026')
})

test('person and team filters narrow the scope; a person outside the team is cleared', async ({ page }) => {
  const ids = await ensureTeam(page)
  await page.goto(pagePath('/progress'))
  await expect(page.getByTestId('people-table')).toBeVisible()

  // Choose a person with the keyboard.
  const person = page.getByRole('combobox', { name: 'Person' })
  await person.focus()
  await person.fill('E2E Admin')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`personId=${ids.admin}`))
  await expect(page.getByTestId('report-range')).toContainText('E2E Admin')
  await expect(page.getByTestId('people-table').locator('tbody tr')).toHaveCount(1)

  // A team the admin is not in: the person filter goes, and says so.
  const team = page.getByRole('combobox', { name: 'Team' })
  await team.fill('Progress Supervisor')
  await page.getByRole('option', { name: /Progress Supervisor/ }).click()
  await expect(page).toHaveURL(new RegExp(`teamId=${ids.supervisor}`))
  await expect(page).not.toHaveURL(/personId=/)
  await expect(page.getByRole('status').filter({ hasText: 'Person filter cleared' })).toBeAttached()
  await expect(card(page, 'card-total')).toHaveText('0')
  const rows = page.getByTestId('people-table').locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Progress Labeller' })).toHaveCount(1)

  // Back restores the person view.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`personId=${ids.admin}`))
  await expect(page.getByTestId('report-range')).toContainText('E2E Admin')

  // Clicking a name in the table selects that person.
  await page.goto(pagePath('/progress'))
  await page.getByTestId('people-table').getByRole('button', { name: 'Progress Labeller' }).click()
  await expect(page).toHaveURL(new RegExp(`personId=${ids.labeller}`))
})

test('people sort with the keyboard and keep their order in the URL', async ({ page }) => {
  await ensureTeam(page)
  await page.goto(pagePath('/progress'))
  const header = page.getByRole('columnheader', { name: /Labeled in period/ })
  await header.getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/sort=labeled/)
  await expect(header).toHaveAttribute('aria-sort', 'descending')
  const first = page.getByTestId('people-table').locator('tbody tr').first()
  await expect(first).toContainText('E2E Admin')
  await page.keyboard.press('Enter')
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await expect(page).not.toHaveURL(/dir=/) // ascending is the default
})

test('a failing section says so while the others work, and Retry recovers it', async ({ page }) => {
  let fail = true
  await page.route('**/progress/activity**', route =>
    fail ? route.fulfill({ status: 500, json: { error: 'Internal server error' } }) : route.fallback()
  )
  // A client-side request: change the period after the server-rendered load.
  await page.goto(pagePath('/progress'))
  await page.getByRole('button', { name: 'Last 90 days' }).click()
  const activity = page.locator('[data-section="activity"]')
  await expect(activity.getByRole('alert')).toContainText('Could not load the activity timeline')
  await expect(page.getByTestId('card-total')).toBeVisible()
  await expect(page.getByTestId('people-table')).toBeVisible()

  fail = false
  await activity.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('activity-chart')).toBeVisible()
  await expect(activity.getByRole('alert')).toHaveCount(0)
})

test('the chart has a table alternative and the page passes axe', async ({ page }) => {
  await page.goto(pagePath('/progress?granularity=week'))
  await expect(page.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Show as table' }).click()
  await expect(page.getByRole('table', { name: /Records labeled per week/ })).toBeVisible()
  await expectAccessible(page, 'progress table')
  await page.getByRole('button', { name: 'Change time zone' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reporting time zone' })
  await expect(dialog.getByLabel('Time zone')).toHaveValue('UTC')
  await expectAccessible(page, 'progress time zone')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Admins change the reporting time zone; the reports follow it.
  await page.getByRole('button', { name: 'Change time zone' }).click()
  await dialog.getByLabel('Time zone').selectOption('Europe/Berlin')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Days in Europe/Berlin')).toBeVisible()
  await page.getByRole('button', { name: 'Change time zone' }).click()
  await dialog.getByRole('button', { name: 'Use the deployment default' }).click()
  await expect(page.getByText('Days in UTC')).toBeVisible()
})
