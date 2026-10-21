import { expect, test } from '@playwright/test'
import { parse } from 'csv-parse/sync'
import { api, failOnCspViolations, rows, signIn } from './helpers'

// Runs after journeys.spec.ts, which leaves "software developer" and
// "hospital nurse" pending (ISCO is the only taxonomy). Both end up submitted
// here; taxonomy-admin.spec.ts does not depend on them.
failOnCspViolations()

test('bulk labelling: select records in the queue, label them at once, export shows the label', async ({ page }) => {
  await signIn(page)
  await expect(page).toHaveURL(/\/queue$/)

  const targets = ['software developer', 'hospital nurse']
  for (const text of targets) {
    await expect(rows(page).filter({ hasText: text })).toHaveCount(1)
    await page.getByLabel(`Select record: ${text}`).check()
  }
  await expect(page.getByText('2 sentences selected')).toBeVisible()

  await page.getByRole('button', { name: 'Bulk Label' }).click()
  const panel = page.getByRole('dialog', { name: 'Bulk label' })
  await expect(panel.getByText('Labeling 2 sentences')).toBeVisible()
  // "02 Technicians" is a leaf at level 1, so it completes the path.
  await panel.getByRole('button', { name: /^02\b/ }).click()
  const bulkRequest = page.waitForResponse(
    res => new URL(res.url()).pathname === api('/sentences/bulk-label') && res.request().method() === 'POST'
  )
  await panel.getByRole('button', { name: 'Submit (2)' }).click()
  expect((await bulkRequest).status()).toBe(200)
  await expect(panel).toHaveCount(0)

  // The queue refreshes; submitted records leave its default (open work) view.
  for (const text of targets) {
    await expect(rows(page).filter({ hasText: text })).toHaveCount(0)
  }

  // The export carries the bulk label for both records, codes as strings.
  const res = await page.request.get(api('/export'))
  expect(res.status()).toBe(200)
  const records = parse(await res.text(), { columns: true, bom: true }) as Array<Record<string, string>>
  for (const text of targets) {
    expect(records.find(r => r.field_job_title === text)).toMatchObject({ ISCO_1: '02', status: 'submitted' })
  }

  // The bulk save is audited once for the operation, not once per record.
  const audit = await page.request.get(api('/audit?action=labels.bulk_applied'))
  expect(audit.status()).toBe(200)
  const { entries } = (await audit.json()) as { entries: Array<{ payload: { records: number; codes: string[] } }> }
  expect(entries).toHaveLength(1)
  expect(entries[0]?.payload).toMatchObject({ records: 2, codes: ['1:02'] })
})
