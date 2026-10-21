import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CredentialError,
  credentialAad,
  credentialKeyId,
  decryptCredential,
  encryptCredential,
  parseKeyring
} from './ai-credentials'

const key = () => randomBytes(32).toString('base64')
const aad = credentialAad('workspace-1', 'connection-1')

describe('AI credential encryption', () => {
  it('round-trips with the active key and records its id', () => {
    const ring = parseKeyring(`new:${key()},old:${key()}`)!
    const stored = encryptCredential('secret-token', aad, ring)
    expect(stored.startsWith('v1.new.')).toBe(true)
    expect(stored).not.toContain('secret-token')
    expect(credentialKeyId(stored)).toBe('new')
    expect(decryptCredential(stored, aad, ring)).toBe('secret-token')
  })

  it('uses a fresh IV, so equal credentials encrypt differently', () => {
    const ring = parseKeyring(`a:${key()}`)!
    expect(encryptCredential('same', aad, ring)).not.toBe(encryptCredential('same', aad, ring))
  })

  it('rotates: old values decrypt while the old key is listed, and not after it is removed', () => {
    const oldKey = key()
    const newKey = key()
    const before = parseKeyring(`old:${oldKey}`)!
    const stored = encryptCredential('token', aad, before)

    const during = parseKeyring(`new:${newKey},old:${oldKey}`)!
    expect(decryptCredential(stored, aad, during)).toBe('token')
    const rotated = encryptCredential(decryptCredential(stored, aad, during), aad, during)
    expect(credentialKeyId(rotated)).toBe('new')

    const after = parseKeyring(`new:${newKey}`)!
    expect(decryptCredential(rotated, aad, after)).toBe('token')
    expect(() => decryptCredential(stored, aad, after)).toThrow('"old" is not in AI_CREDENTIALS_KEYS')
  })

  it('refuses a value moved to another connection or altered', () => {
    const ring = parseKeyring(`a:${key()}`)!
    const stored = encryptCredential('token', aad, ring)
    expect(() => decryptCredential(stored, credentialAad('workspace-2', 'connection-1'), ring)).toThrow(CredentialError)
    const parts = stored.split('.')
    parts[4] = Buffer.from('tampered').toString('base64url')
    expect(() => decryptCredential(parts.join('.'), aad, ring)).toThrow('could not be decrypted')
  })

  it('validates AI_CREDENTIALS_KEYS without echoing key material', () => {
    expect(parseKeyring(undefined)).toBeNull()
    expect(parseKeyring(' ')).toBeNull()
    const short = Buffer.from('too-short').toString('base64')
    expect(() => parseKeyring(`a:${short}`)).toThrow('must be 32 bytes')
    try {
      parseKeyring(`a:${short}`)
    } catch (error) {
      expect(String(error)).not.toContain(short)
    }
    expect(() => parseKeyring(key())).toThrow('expected <keyId>:<base64 key>')
    const k = key()
    expect(() => parseKeyring(`a:${k},a:${k}`)).toThrow('twice')
  })
})
