import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { ADMIN, WORKSPACE_ID } from './fixtures'

// The app runs with mail on (playwright.config.ts) and posts to this stand-in
// for the n8n workflow, which keeps the messages for the journeys.
const MAIL_PORT = Number(process.env.E2E_PORT || 3200) + 1
const mails: Array<{ to: string; subject: string; body: string }> = []
let server: Server

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      if (req.headers['send-email-api'] === 'e2e-only-mail-secret') mails.push(JSON.parse(raw))
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(MAIL_PORT, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

test('invite a new member by email; they choose a password from the link and sign in', async ({ page, browser }) => {
  await page.goto('/login')
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/queue$/)

  await page.goto(`/w/${WORKSPACE_ID}/admin/team`)
  await expect(page.getByText('Email: on')).toBeVisible()
  await page.getByRole('button', { name: 'Add member' }).click()
  await page.getByLabel('Username', { exact: true }).fill('e2e-invited')
  await page.getByLabel('Email', { exact: true }).fill('e2e-invited@test.local')
  await page.getByLabel('Name', { exact: true }).fill('Ida Invited')
  await expect(page.getByLabel('Email a link to choose a password')).toBeChecked()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('e2e-invited created; an invitation link is on its way')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'e2e-invited' })).toContainText('invited')

  await expect.poll(() => mails.filter(m => m.to === 'e2e-invited@test.local').length).toBe(1)
  const mail = mails.find(m => m.to === 'e2e-invited@test.local')!
  const link = /href="([^"]*\/set-password#t=[^"]+)"/.exec(mail.body)?.[1]
  expect(link).toBeTruthy()

  // A different browser, signed out, as the invited person.
  const context = await browser.newContext()
  const invited = await context.newPage()
  await invited.goto(link!)
  await expect(invited.getByRole('heading', { name: 'Welcome to classiflow' })).toBeVisible()
  // The token has left the address bar.
  expect(invited.url()).not.toContain('#t=')
  await invited.getByLabel('New password').fill('my-own-chosen-words')
  await invited.getByLabel('Repeat the password').fill('my-own-chosen-words')
  await invited.getByRole('button', { name: 'Save password' }).click()
  await expect(invited.getByText(/You can now sign in as/)).toBeVisible()

  await invited.getByRole('link', { name: 'Sign in' }).click()
  await invited.getByLabel(/username or email/i).fill('e2e-invited')
  await invited.getByLabel(/password/i).fill('my-own-chosen-words')
  await invited.getByRole('button', { name: /sign in/i }).click()
  await expect(invited).toHaveURL(/\/queue$/)
  await context.close()
})

test('a new person creates their account from a workspace invitation; the link then stops working', async ({
  page,
  browser
}) => {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/queue$/)

  const email = `e2e-setup-${Date.now()}@test.local`
  await page.goto(`/w/${WORKSPACE_ID}/admin/team`)
  await page.getByRole('button', { name: 'Add member' }).click()
  await page.getByLabel('Invite by email').check()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible()

  await expect.poll(() => mails.filter(m => m.to === email).length).toBe(1)
  const link = /href="([^"]*\/invitation#t=[^"]+)"/.exec(mails.find(m => m.to === email)!.body)?.[1]
  expect(link).toBeTruthy()

  // Signed out, as the invited person.
  const context = await browser.newContext()
  const invited = await context.newPage()
  await invited.goto(link!)
  await expect(invited.getByRole('heading', { name: 'Workspace invitation' })).toBeVisible()
  expect(invited.url()).not.toContain('#t=')
  await invited.getByLabel('Name', { exact: true }).fill('Sam Setup')
  await invited.getByLabel('Choose a password').fill('amber-harbour-lantern-91')
  await invited.getByRole('button', { name: 'Create account and join' }).click()
  await expect(invited.getByText('Your account and workspace access are ready')).toBeVisible()

  // The link was used: opening it again does not offer a second setup.
  const replay = await context.newPage()
  await replay.goto(link!)
  await expect(replay.getByRole('heading', { name: 'This invitation does not work' })).toBeVisible()

  await invited.goto('/login')
  await invited.getByLabel(/username or email/i).fill(email)
  await invited.getByLabel(/password/i).fill('amber-harbour-lantern-91')
  await invited.getByRole('button', { name: /sign in/i }).click()
  await expect(invited).toHaveURL(/\/queue$/)
  await context.close()
})
