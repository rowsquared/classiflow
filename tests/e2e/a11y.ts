import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// Accessibility check for the journeys: axe-core on the current page, failing
// on serious and critical violations (contrast, names, roles, ARIA). Minor
// and moderate findings are not gated yet.

type Options = {
  /** CSS selectors to leave out, each with a comment saying why and who fixes it. */
  exclude?: string[]
  /** Rules to skip on this page, same rule. */
  disableRules?: string[]
}

/**
 * Known findings that are accepted for now, by page name, each with the file
 * that needs the fix. Empty: add an entry only with a reason, and remove it
 * with the fix.
 */
const KNOWN: Record<string, Options> = {}

export async function expectAccessible(page: Page, name: string, options: Options = {}) {
  const known = KNOWN[name] ?? {}
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  for (const selector of [...(known.exclude ?? []), ...(options.exclude ?? [])]) builder = builder.exclude(selector)
  const disabled = [...(known.disableRules ?? []), ...(options.disableRules ?? [])]
  if (disabled.length > 0) builder = builder.disableRules(disabled)

  const { violations } = await builder.analyze()
  const serious = violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map(n => n.target.join(' '))
    }))
  expect(serious, `${name}: serious accessibility violations`).toEqual([])
}
