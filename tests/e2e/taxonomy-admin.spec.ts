import { expect, test, type Page } from '@playwright/test'
import { api, failOnCspViolations, pagePath, signIn } from './helpers'

// Runs last. Creates a second taxonomy (COICOP) and deletes it again at the
// end, so the workspace is left with ISCO only, as the seed made it.
test.describe.configure({ mode: 'serial' })
failOnCspViolations()

const KEY = 'COICOP'
// Codes with leading zeros: they must survive CSV parsing, storage and display.
const CSV = [
  'id,label,parent_id,level',
  '01,Food and non-alcoholic beverages,,1',
  '011,Food,01,2',
  '0111,Bread and cereals,011,3',
  '012,Non-alcoholic beverages,01,2',
  '02,Alcoholic beverages and tobacco,,1'
].join('\n')

async function openTaxonomyAdmin(page: Page) {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto(pagePath('/admin/taxonomy'))
  await expect(page.getByRole('heading', { name: 'ISCO', exact: true })).toBeVisible()
}

const card = (page: Page) =>
  page
    .getByTestId('taxonomy-card')
    .filter({ has: page.getByRole('heading', { name: KEY, exact: true }) })
    .first()

test('a taxonomy is created from a CSV, keeps its leading zeros and can be browsed', async ({ page }) => {
  await openTaxonomyAdmin(page)
  await page.getByRole('button', { name: 'Add new taxonomy' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create new taxonomy' })
  await dialog.getByPlaceholder('e.g. ISCO').fill(KEY.toLowerCase())
  await expect(dialog.getByPlaceholder('e.g. ISCO')).toHaveValue(KEY)
  await dialog.locator('#create-file-input').setInputFiles({
    name: 'coicop.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV)
  })
  await expect(dialog.getByText('Detected maximum depth: 3 levels')).toBeVisible()
  await dialog.getByRole('button', { name: 'Validate file' }).click()
  await expect(dialog.getByText('Validation passed')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create & Import' }).click()

  await expect(page.getByText(`Successfully created taxonomy "${KEY}" with 5 nodes!`)).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(card(page)).toContainText('5 nodes')
  await expect(card(page)).toContainText('3 levels')

  // Browse down to the third level.
  await page.goto(pagePath(`/taxonomies/${KEY}`))
  await expect(page.getByRole('heading', { name: `${KEY} taxonomy` })).toBeVisible()
  await page.getByRole('button', { name: /^01 · Food and non-alcoholic beverages/ }).click()
  await page.getByRole('button', { name: /^011 · Food/ }).click()
  await expect(page.getByRole('button', { name: /^0111 · Bread and cereals/ })).toBeVisible()
  // Search finds codes as text, leading zeros included.
  await page.getByPlaceholder('Search code or text...').fill('0111')
  await expect(page.getByRole('button', { name: /^0111 · Bread and cereals/ })).toBeVisible()
})

test('nodes can be added incrementally under existing ones', async ({ page }) => {
  await openTaxonomyAdmin(page)
  const addition = 'id,label,parent_id,level\n0112,Meat,011,3\n0121,Coffee and tea,012,3\n'
  const url = api(`/taxonomies/${KEY}/import`)

  // A dry run validates without writing.
  const dry = await page.request.post(url, { headers: { 'Content-Type': 'text/csv' }, data: addition })
  expect(await dry.json()).toMatchObject({ ok: true, dryRun: true, count: 2 })
  const commit = await page.request.post(`${url}?dryRun=false`, {
    headers: { 'Content-Type': 'text/csv' },
    data: addition
  })
  expect(commit.status()).toBe(200)

  await page.reload()
  await expect(card(page)).toContainText('7 nodes')

  // 012 gained a child, so it is no longer a leaf; the browser shows the new level.
  await page.goto(pagePath(`/taxonomies/${KEY}`))
  await page.getByRole('button', { name: /^01 · / }).click()
  await page.getByRole('button', { name: /^012 · Non-alcoholic beverages/ }).click()
  await expect(page.getByRole('button', { name: /^0121 · Coffee and tea/ })).toBeVisible()
})

test('the description can be edited, and the taxonomy deleted after typing DELETE', async ({ page }) => {
  await openTaxonomyAdmin(page)

  await card(page).getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: `Edit taxonomy ${KEY}` })
  await edit.locator('textarea').fill('Household consumption by purpose')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(`Successfully updated taxonomy "${KEY}"!`)).toBeVisible()
  await expect(card(page)).toContainText('Household consumption by purpose')

  await card(page).getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete taxonomy' })
  const remove = confirm.getByRole('button', { name: 'Delete taxonomy' })
  await expect(remove).toBeDisabled()
  await confirm.getByPlaceholder('DELETE').fill('DELETE')
  await remove.click()
  await expect(page.getByText(`Successfully deleted taxonomy "${KEY}".`)).toBeVisible()
  await expect(page.getByRole('heading', { name: KEY, exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ISCO', exact: true })).toBeVisible()

  const active = await page.request.get(api('/taxonomies/active'))
  const { taxonomies } = (await active.json()) as { taxonomies: Array<{ key: string }> }
  expect(taxonomies.map(t => t.key)).toEqual(['ISCO'])
})
