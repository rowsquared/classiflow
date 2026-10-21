import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encryption of AI connection credentials at rest (AES-256-GCM).
 *
 * Keys come from AI_CREDENTIALS_KEYS, a comma-separated list of
 * `<keyId>:<base64 of 32 random bytes>` (generate one with
 * `openssl rand -base64 32`). The first key encrypts; every listed key can
 * decrypt, so a key is rotated by putting a new one first, running
 * `node scripts/rotate-ai-credentials.ts` and then removing the old one.
 *
 * A stored value is `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). The
 * additional authenticated data binds it to its connection row, so a value
 * copied onto another workspace's row does not decrypt.
 *
 * Plaintext credentials exist only in memory: they are never returned by an
 * API, logged, audited or written to a job row. Without its key a database
 * backup holds no usable credential; back the keys up separately.
 *
 * No `@/` imports: scripts/rotate-ai-credentials.ts loads this file directly.
 */

export type CredentialKey = { id: string; key: Buffer }
export type Keyring = { active: CredentialKey; keys: Map<string, CredentialKey> }

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/
const FORMAT = 'v1'

export class CredentialError extends Error {
  name = 'CredentialError'
}

/** Parses an AI_CREDENTIALS_KEYS value. Throws (without echoing key material) when malformed. */
export function parseKeyring(value: string | undefined): Keyring | null {
  const entries = (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  if (entries.length === 0) return null
  const keys = new Map<string, CredentialKey>()
  for (const [index, entry] of entries.entries()) {
    const separator = entry.indexOf(':')
    const id = separator > 0 ? entry.slice(0, separator) : ''
    if (!KEY_ID.test(id)) {
      throw new CredentialError(`AI_CREDENTIALS_KEYS entry ${index + 1}: expected <keyId>:<base64 key>`)
    }
    const key = Buffer.from(entry.slice(separator + 1), 'base64')
    if (key.length !== 32) {
      throw new CredentialError(`AI_CREDENTIALS_KEYS key "${id}" must be 32 bytes, base64-encoded`)
    }
    if (keys.has(id)) throw new CredentialError(`AI_CREDENTIALS_KEYS lists key "${id}" twice`)
    keys.set(id, { id, key })
  }
  const active = keys.get(entries[0]!.slice(0, entries[0]!.indexOf(':')))!
  return { active, keys }
}

/** The deployment's keyring, or null when AI credentials are not configured. */
export function deploymentKeyring(): Keyring | null {
  return parseKeyring(process.env.AI_CREDENTIALS_KEYS)
}

const b64 = (buffer: Buffer) => buffer.toString('base64url')

export function encryptCredential(plaintext: string, aad: string, keyring: Keyring): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyring.active.key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [FORMAT, keyring.active.id, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join('.')
}

/** The id of the key a stored value was encrypted with. */
export function credentialKeyId(stored: string): string {
  const [format, keyId] = stored.split('.')
  if (format !== FORMAT || !keyId) throw new CredentialError('Stored credential has an unknown format')
  return keyId
}

export function decryptCredential(stored: string, aad: string, keyring: Keyring): string {
  const parts = stored.split('.')
  if (parts.length !== 5 || parts[0] !== FORMAT) throw new CredentialError('Stored credential has an unknown format')
  const [, keyId, iv, tag, ciphertext] = parts as [string, string, string, string, string]
  const key = keyring.keys.get(keyId)
  if (!key) throw new CredentialError(`The AI credential key "${keyId}" is not in AI_CREDENTIALS_KEYS`)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new CredentialError('The AI credential could not be decrypted (wrong key or altered value)')
  }
}

/** Additional authenticated data of a connection's credential. */
export function credentialAad(workspaceId: string, connectionId: string): string {
  return `classiflow:ai-credential:${workspaceId}:${connectionId}`
}
