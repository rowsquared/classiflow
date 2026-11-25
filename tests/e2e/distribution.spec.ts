import { expect, test } from '@playwright/test'
import { api, pagePath, seedBeforeAll, signIn } from './helpers'

seedBeforeAll()

test('distributes a cross-page queue selection based on open workload', async ({ page }) => {
  await signIn(page)
  const created = await page.request.post(api('/users'), {
    data: {
      name: 'Distribution Labeller',
      email: 'distribution@test.local',
      role: 'labeller',
      tempPassword: 'Saffron-ridge-paper-837'
    }
  })
  expect(created.ok(), await created.text()).toBe(true)
  const { users } = await (await page.request.get(api('/users'))).json()
  const busy = users.find((user: { name: string }) => user.name === 'E2E Labeller')
  const { sentences } = await (await page.request.get(api('/sentences?status=pending&sort=createdAt&order=asc'))).json()
  const assigned = await page.request.post(api('/sentences/assign'), {
    data: { userIds: [busy.id], sentenceIds: sentences.slice(0, 2).map((record: { id: string }) => record.id) }
  })
  expect(assigned.ok(), await assigned.text()).toBe(true)

  await page.goto(pagePath('/queue?tab=pending&limit=1'))
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Select all 3 matching records' }).click()
  await expect(page.getByText('All 3 matching records selected')).toBeVisible()
  await page.getByRole('link', { name: 'Distribute work' }).click()
  await expect(page.getByRole('heading', { name: 'Distribute work' })).toBeVisible()
  await page.getByRole('checkbox', { name: /E2E Labeller/ }).check()
  await page.getByRole('checkbox', { name: /Distribution Labeller/ }).check()
  await page.getByRole('radio', { name: /Balance existing workloads/ }).check()
  await page.getByRole('button', { name: 'Preview distribution' }).click()
  await expect(page.getByText('3 matching · 1 eligible · 2 left out')).toBeVisible()
  await expect(page.getByRole('row', { name: /^E2E Labeller/ }).getByRole('cell')).toHaveText(['2', '0', '2'])
  await expect(page.getByRole('row', { name: /^Distribution Labeller/ }).getByRole('cell')).toHaveText(['0', '1', '1'])
  await page.getByRole('button', { name: 'Assign 1 record' }).click()
  await expect(page.getByText('Assigned 1 record.')).toBeVisible()

  await page.getByRole('link', { name: 'Back to queue' }).click()
  await expect(page).toHaveURL(url => url.pathname === pagePath('/queue') && url.searchParams.get('limit') === '1')
  const { sentences: updated } = await (
    await page.request.get(api('/sentences?status=pending&sort=createdAt&order=asc'))
  ).json()
  expect(updated[2].assignments.map((assignment: { user: { name: string } }) => assignment.user.name)).toContain(
    'Distribution Labeller'
  )
})
