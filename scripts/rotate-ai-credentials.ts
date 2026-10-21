// Re-encrypts every stored AI connection credential with the active key, the
// first entry of AI_CREDENTIALS_KEYS (lib/ai-credentials.ts).
//
// Rotating a key:
//   1. Put the new key first in AI_CREDENTIALS_KEYS, keep the old one after
//      it, and restart (new credentials now use the new key; old ones still
//      decrypt with the old key).
//   2. node scripts/rotate-ai-credentials.ts           # in the container:
//      docker compose exec app node scripts/rotate-ai-credentials.ts
//   3. When it reports nothing left under the old key, remove that key and
//      restart.
//
// DATABASE_URL must be the schema owner (as in the container), which sees the
// connections of every workspace. `--check` only counts values per key.
// Credentials are never printed.
import { connect } from './lib/db.ts'
import {
  credentialAad,
  credentialKeyId,
  decryptCredential,
  deploymentKeyring,
  encryptCredential
} from '../lib/ai-credentials.ts'

const prisma = connect()

async function rotate(checkOnly: boolean) {
  const keyring = deploymentKeyring()
  if (!keyring) throw new Error('AI_CREDENTIALS_KEYS is not set')
  const rows = await prisma.aIConnectionVersion.findMany({
    where: { credential: { not: null } },
    select: { id: true, workspaceId: true, credential: true }
  })
  const byKey = new Map<string, number>()
  let rotated = 0
  for (const row of rows) {
    const stored = row.credential!
    const keyId = credentialKeyId(stored)
    byKey.set(keyId, (byKey.get(keyId) ?? 0) + 1)
    if (checkOnly || keyId === keyring.active.id) continue
    const aad = credentialAad(row.workspaceId, row.id)
    const credential = encryptCredential(decryptCredential(stored, aad, keyring), aad, keyring)
    // Only if nobody changed the row meanwhile.
    const result = await prisma.aIConnectionVersion.updateMany({
      where: { id: row.id, credential: stored },
      data: { credential }
    })
    rotated += result.count
  }
  for (const [keyId, count] of byKey) console.log(`  ${keyId}: ${count} credential(s)`)
  if (!checkOnly) console.log(`✓ Re-encrypted ${rotated} credential(s) with key "${keyring.active.id}"`)
}

rotate(process.argv.includes('--check'))
  .catch(error => {
    console.error('✗ Rotation failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
