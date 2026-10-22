import { readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'

// The image runs scripts/*.ts with Node's type stripping (scripts/start.sh,
// the restore drill, key rotation), so every file outside scripts/ that they
// import at runtime must be copied into the runner stage of the Dockerfile.
// A missing one only shows when the container starts.

const root = join(__dirname, '..')
const IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+\.ts)'/gm

function runtimeImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen
  seen.add(file)
  const source = readFileSync(join(root, file), 'utf8')
  for (const match of source.matchAll(IMPORT)) {
    // Repository paths with forward slashes on every platform, as in the Dockerfile.
    const target = posix.normalize(posix.join(posix.dirname(file), match[1] ?? ''))
    if (target.startsWith('lib/generated/')) continue
    runtimeImports(target, seen)
  }
  return seen
}

describe('Dockerfile', () => {
  it('copies every file the scripts import at runtime', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const scripts = readdirSync(join(root, 'scripts'))
      .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map(name => `scripts/${name}`)
    const needed = new Set<string>()
    for (const script of scripts) {
      for (const file of runtimeImports(script)) {
        if (!file.startsWith('scripts/')) needed.add(file)
      }
    }
    const missing = [...needed].filter(file => !dockerfile.includes(`/app/${file} ./${file}`))
    expect(missing).toEqual([])
  })
})
