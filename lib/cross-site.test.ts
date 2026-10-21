import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { isCrossSiteMutation } from './cross-site'

const req = (method: string, path: string, headers: Record<string, string>) =>
  new NextRequest(new URL(path, 'http://app.example.org'), { method, headers })

describe('isCrossSiteMutation', () => {
  it('refuses data changes from another origin', () => {
    expect(isCrossSiteMutation(req('POST', '/api/flag', { host: 'app.example.org', origin: 'https://evil.test' }))).toBe(true)
    expect(isCrossSiteMutation(req('DELETE', '/api/x', { host: 'app.example.org', origin: 'not a url' }))).toBe(true)
  })

  it('allows same-origin, proxied, origin-less and safe requests', () => {
    expect(isCrossSiteMutation(req('POST', '/api/x', { host: 'app.example.org', origin: 'https://app.example.org' }))).toBe(false)
    expect(isCrossSiteMutation(req('POST', '/api/x', { host: 'internal:3000', 'x-forwarded-host': 'app.example.org', origin: 'https://app.example.org' }))).toBe(false)
    expect(isCrossSiteMutation(req('POST', '/api/x', { host: 'app.example.org' }))).toBe(false)
    expect(isCrossSiteMutation(req('GET', '/api/x', { host: 'app.example.org', origin: 'https://evil.test' }))).toBe(false)
  })

  it('leaves Auth.js routes to Auth.js but checks the reset endpoint', () => {
    expect(isCrossSiteMutation(req('POST', '/api/auth/callback/credentials', { host: 'a', origin: 'https://evil.test' }))).toBe(false)
    expect(isCrossSiteMutation(req('POST', '/api/auth/reset-password', { host: 'a', origin: 'https://evil.test' }))).toBe(true)
  })
})
