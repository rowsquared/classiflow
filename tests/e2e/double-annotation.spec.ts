import { expect, test, type Browser, type Page } from '@playwright/test'
import { parse } from 'csv-parse/sync'
import { signIn, failOnCspViolations } from './helpers'
import { expectAccessible } from './a11y'

// Double annotation end to end, in its own workspace (archived afterwards):
// the admin starts it from the assignment dialog, two labellers answer blind
// and disagree, the admin resolves it from the "Needs review" shortcut, and
// the confirmed-only export carries the decision. Changes nothing the other
// specs use.
failOnCspViolations()
let workspaceId = ''
const api = (path: string) => `/api/workspaces/${workspaceId}${path}`
const view = (path: string) => `/w/${workspaceId}${path}`
const PASSWORD = 'Blind-pair-handover-123'
const OWN_PASSWORD = 'violet-harbour-lantern-58'

test.afterEach(async ({ page }) => {
  if (workspaceId) expect((await page.request.put(api(''), { data: { status: 'archived' } })).status()).toBe(200)
})

async function labeller(page: Page, username: string, name: string) {
  const response = await page.request.post(api('/users'), {
    data: {
      username,
      email: `${username}@test.local`,
      name,
      role: 'labeller',
      access: 'password',
      tempPassword: PASSWORD
    }
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).user.id as string
}

/** Signs a new labeller in (in their own browser context) and sets their password. */
async function signInAs(browser: Browser, username: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(username)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).toHaveURL(/\/reset-password/)
  // The first sign-in asks for a new password (journeys.spec.ts covers that page).
  const reset = await page.request.post('/api/auth/reset-password', {
    data: { currentPassword: PASSWORD, newPassword: OWN_PASSWORD }
  })
  expect(reset.status(), await reset.text()).toBe(200)
  return { page, close: () => context.close() }
}

async function choose(page: Page, label: string, name: string) {
  const input = page.getByRole('combobox', { name: label })
  await input.fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

test('two labellers answer blind, a disagreement is reviewed, the confirmed export has the decision', async ({
  page,
  browser
}) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue/)
  const created = await page.request.post('/api/workspaces', { data: { name: 'Double annotation journey' } })
  expect(created.status()).toBe(201)
  workspaceId = (await created.json()).workspace.id
  const taxonomy = await page.request.post(api('/taxonomies'), {
    multipart: {
      key: 'A',
      maxDepth: '2',
      file: {
        name: 'a.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('id,label,parent_id,level\n01,Group,,1\n011,Leaf,01,2\n02,Other leaf,,1')
      }
    }
  })
  expect(taxonomy.status()).toBe(200)
  const imported = await page.request.post(api('/sentences/import?dryRun=false'), {
    multipart: { file: { name: 'r.csv', mimeType: 'text/csv', buffer: Buffer.from('id,field_text\n1,Double record') } }
  })
  expect(imported.status()).toBe(200)
  await labeller(page, 'double-ada', 'Ada Double')
  await labeller(page, 'double-ben', 'Ben Double')

  // Start: two people, a preview, then the commit.
  await page.goto(view('/queue?tab=all'))
  await page.getByLabel('Select record: Double record').check()
  await page.getByRole('button', { name: 'Assign / unassign' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage assignments' })
  await dialog.getByRole('button', { name: 'Two independent labels' }).click()
  await choose(page, 'First person', 'Ada Double')
  await choose(page, 'Second person', 'Ben Double')
  await expect(dialog.getByText('1 not yet labelled: both people label them')).toBeVisible()
  await expectAccessible(page, 'double annotation dialog')
  await dialog.getByRole('button', { name: 'Start double annotation for 1' }).click()
  await expect(dialog).toHaveCount(0)
  const [record] = (await (await page.request.get(api('/sentences'))).json()).sentences as Array<{ id: string }>

  // Ada answers 011, Ben answers 02; each sees only their own answer.
  for (const [username, code] of [
    ['double-ada', '011'],
    ['double-ben', '02']
  ] as const) {
    const person = await signInAs(browser, username)
    await person.page.goto(view(`/queue/${record!.id}`))
    await expect(person.page.getByText('Independent labelling: you see only your own answer.')).toBeVisible()
    await expect(person.page.getByRole('button', { name: /^Remove label/ })).toHaveCount(0)
    if (code === '011') await person.page.getByRole('button', { name: /^01\b/ }).click()
    await person.page.getByRole('button', { name: new RegExp(`^${code}\\b`) }).click()
    const saved = person.page.waitForResponse(
      res => res.url().endsWith(`/sentences/${record!.id}/annotations`) && res.request().method() === 'POST'
    )
    await person.page.getByRole('button', { name: /^Submit/ }).click()
    expect((await saved).status()).toBe(200)
    await person.close()
  }

  // The admin finds it through the shortcut and uses Ben's answer.
  await page.goto(view('/queue?tab=all'))
  await page.getByRole('button', { name: 'Needs review · 1' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.goto(view(`/queue/${record!.id}`))
  const panel = page.getByRole('region', { name: 'Double annotation' })
  await expect(panel.getByText('Needs review')).toBeVisible()
  await expectAccessible(page, 'double annotation review')
  await panel.getByRole('button', { name: 'Use this answer' }).nth(1).click()
  await expect
    .poll(async () => (await (await page.request.get(api(`/sentences/${record!.id}`))).json()).status)
    .toBe('submitted')

  const csv = await (await page.request.get(api('/export?labels=confirmed'))).text()
  const rows = parse(csv, { columns: true, bom: true }) as Array<Record<string, string>>
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ A_1: '02', annotation_mode: 'double', A_annotation_status: 'reviewed' })
})
