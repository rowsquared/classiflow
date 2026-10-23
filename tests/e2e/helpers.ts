import { expect, test, type Page } from '@playwright/test'
import { ADMIN, WORKSPACE_ID } from './fixtures'

// Shared by the journey files. They run one after another against one seeded
// database (workers: 1), in file name order: journeys, labelling-bulk,
// taxonomy-admin. Later files may rely on what earlier ones left behind and
// must leave the data as the next ones expect (see each file's header).

export const api = (path: string) => `/api/workspaces/${WORKSPACE_ID}${path}`
export const pagePath = (path: string) => `/w/${WORKSPACE_ID}${path}`

export async function signIn(page: Page, password = ADMIN.password) {
  await page.goto('/login')
  await page.getByLabel(/username or email/i).fill(ADMIN.username)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  if (password === ADMIN.password) {
    await expect(page).toHaveURL(/\/(?:queue|workspaces)$/)
    // Later journeys create more workspaces; keep shared record journeys on their fixture workspace.
    if (new URL(page.url()).pathname === '/workspaces') await page.goto(pagePath('/queue'))
  }
}

export const rows = (page: Page) => page.locator('tbody tr')

/**
 * The Content-Security-Policy is enforced (proxy.ts); any violation is logged
 * to the console and fails the journey. Call once at the top of a spec file.
 */
export function failOnCspViolations() {
  let reports: string[] = []
  test.beforeEach(({ page }) => {
    reports = []
    page.on('console', msg => {
      if (msg.text().includes('Content Security Policy')) reports.push(msg.text())
    })
  })
  test.afterEach(() => {
    expect(reports).toEqual([])
  })
}
