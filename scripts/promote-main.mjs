#!/usr/bin/env node
// Promote staging to main as a fast-forward. See "Releases" in DEPLOYMENT.md.
//
// Production deploys from main, and main is only ever staging at an earlier
// point in time. This refuses anything that is not a fast-forward, so main can
// never gain a commit that did not sit on staging first, and the two branches
// stay in sync.
//
// Pushing does not deploy on its own: Coolify auto-deploy is off for
// production, and the deploy-prod job in .github/workflows/ci.yml triggers it
// only after the smoke job passes. If the main ruleset requires the smoke
// check, the push is also rejected until CI has passed on staging.
//
//   node scripts/promote-main.mjs --dry-run   # show what would move
//   node scripts/promote-main.mjs             # promote

import { execFileSync, spawnSync } from 'node:child_process'

const SOURCE = 'staging'
const TARGET = 'main'
const dryRun = process.argv.includes('--dry-run')

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`git ${args.join(' ')} failed:\n${(result.stderr || result.stdout).trim()}`)
    process.exit(1)
  }
  return result.stdout.trim()
}

console.log(`Fetching ${SOURCE} and ${TARGET} ...`)
git('fetch', 'origin', '--force',
  `${SOURCE}:refs/remotes/origin/${SOURCE}`,
  `${TARGET}:refs/remotes/origin/${TARGET}`)

const source = git('rev-parse', `refs/remotes/origin/${SOURCE}`)
const target = git('rev-parse', `refs/remotes/origin/${TARGET}`)

if (source === target) {
  console.log(`${TARGET} already matches ${SOURCE} at ${source.slice(0, 8)}. Nothing to promote.`)
  process.exit(0)
}

// --is-ancestor is the fast-forward test: main must already be contained in
// staging, or moving it would discard production history.
const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', target, source]).status === 0
if (!isAncestor) {
  console.error(
    `Refusing to promote: ${TARGET} (${target.slice(0, 8)}) is not an ancestor of ` +
    `${SOURCE} (${source.slice(0, 8)}), so this would not be a fast-forward.\n` +
    `${TARGET} carries commits that are not on ${SOURCE}. Merge ${TARGET} into ${SOURCE} ` +
    `(through CI), then promote again.`)
  process.exit(1)
}

const log = git('log', '--oneline', '--no-decorate', `${target}..${source}`)
console.log(`\n${log.split('\n').length} commit(s) would move ${TARGET} ${target.slice(0, 8)} -> ${source.slice(0, 8)}:\n`)
console.log(log)

if (dryRun) {
  console.log('\n--dry-run: nothing pushed.')
  process.exit(0)
}

console.log(`\nPushing ${source.slice(0, 8)} to ${TARGET} ...`)
try {
  execFileSync('git', ['push', 'origin', `${source}:refs/heads/${TARGET}`], { stdio: 'inherit' })
} catch {
  console.error(
    `\nPush rejected. If the ruleset requires the smoke check, CI on ${SOURCE} has not ` +
    `passed for ${source.slice(0, 8)} yet: wait for it (or fix it) and run this again.`)
  process.exit(1)
}
git('update-ref', `refs/remotes/origin/${TARGET}`, source)
console.log(
  `\nPromoted. CI is now running on ${TARGET}; production deploys only if it passes. ` +
  'Watch the run in the Actions tab, then the Coolify UI.')
