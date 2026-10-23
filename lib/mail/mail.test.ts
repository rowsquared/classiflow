import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMailConfig } from './config'
import { escapeHtml, renderMail } from './layout'
import { foldSubject, outcomeForStatus, sendViaN8n } from './n8n'
import { credentialsMail, invitationMail, passwordLinkMail, passwordChangedMail, emailChangedMail } from './templates'

const config = readMailConfig({
  N8N_EMAIL_WEBHOOK_SECRET: 'secret-value',
  N8N_EMAIL_WEBHOOK_TIMEOUT: '1',
  APP_BASE_URL: 'https://app.example.org/'
})
const message = { to: 'a@example.org', subject: 'Hi', html: '<p>x</p>', text: 'x' }

describe('mail configuration', () => {
  it('is off without the secret or a base URL, and never reads the request host', () => {
    expect(readMailConfig({}).transport).toBe('off')
    expect(readMailConfig({ N8N_EMAIL_WEBHOOK_SECRET: 's' }).transport).toBe('off')
    expect(readMailConfig({ N8N_EMAIL_WEBHOOK_SECRET: 's', BETTER_AUTH_URL: 'https://b.org' })).toMatchObject({
      transport: 'n8n',
      baseUrl: 'https://b.org',
      webhookUrl: 'https://n8n.rowsquared.com/webhook/send-email',
      webhookHeader: 'send-email-api',
      timeoutMs: 15_000,
      invitationHours: 72,
      passwordLinkMinutes: 60
    })
    expect(config.baseUrl).toBe('https://app.example.org')
  })

  it('keeps finished outbox rows 90 days unless told otherwise; 0 keeps them', () => {
    expect(readMailConfig({}).retentionDays).toBe(90)
    expect(readMailConfig({ MAIL_RETENTION_DAYS: '30' }).retentionDays).toBe(30)
    expect(readMailConfig({ MAIL_RETENTION_DAYS: '0' }).retentionDays).toBeNull()
    expect(readMailConfig({ MAIL_RETENTION_DAYS: 'x' }).retentionDays).toBe(90)
  })
})

describe('n8n transport', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps answers to sent, failed and unknown', () => {
    expect([200, 204, 401, 422, 500, 502].map(outcomeForStatus)).toEqual([
      'sent',
      'sent',
      'failed',
      'failed',
      'unknown',
      'unknown'
    ])
  })

  it('posts to, subject and HTML body with the secret header', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await sendViaN8n(config, { ...message, subject: 'Line one\r\nBcc: x' }, fetchImpl)).toEqual({
      outcome: 'sent'
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['send-email-api']).toBe('secret-value')
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'a@example.org',
      subject: 'Line one Bcc: x',
      body: '<p>x</p>'
    })
  })

  it('reports timeouts and network errors as unknown, never failed', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const dns = vi.fn(async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND')
    })
    expect((await sendViaN8n(config, message, timeout)).outcome).toBe('unknown')
    expect((await sendViaN8n(config, message, dns)).outcome).toBe('unknown')
  })

  it('does not quote the reply or log the payload', async () => {
    const log = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'warn')
    const info = vi.spyOn(console, 'log')
    const result = await sendViaN8n(
      config,
      { ...message, html: 'Temporary password: s3cret-in-body' },
      async () => new Response('echo: Temporary password: s3cret-in-body', { status: 400 })
    )
    expect(result.outcome).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('s3cret')
    for (const spy of [log, warn, info]) expect(JSON.stringify(spy.mock.calls)).not.toContain('s3cret')
  })

  it('folds subjects to one bounded line', () => {
    expect(foldSubject('  a\n\tb  ')).toBe('a b')
    expect(foldSubject('x'.repeat(300))).toHaveLength(200)
  })
})

describe('layout and templates', () => {
  it('uses the email address as the sign-in identifier in account emails', () => {
    const email = 'peter@example.org'
    const account = { name: 'Peter', email }
    const welcome = invitationMail({
      ...account,
      workspaceName: null,
      role: null,
      url: 'https://app/set-password#t=example',
      hours: 72
    })
    const credentials = credentialsMail({
      ...account,
      password: 'temporary-example-73',
      workspaceName: null,
      role: null,
      signInUrl: 'https://app/login'
    })
    const mails = [
      welcome,
      credentials,
      passwordLinkMail({ ...account, url: 'https://app/set-password#t=example', minutes: 30 }),
      passwordChangedMail({ ...account, signInUrl: 'https://app/login' }),
      emailChangedMail({ email })
    ]
    for (const mail of mails) {
      expect(mail.html).toContain(email)
      expect(mail.text).toContain(email)
      expect(mail.text).not.toMatch(/username|user_[a-f0-9]{32}/i)
    }
    expect(welcome.text).toContain(`Your sign-in email is ${email}`)
    expect(credentials.text).toContain(`Email: ${email}`)
  })

  it('escapes interpolated values', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;')
    const mail = invitationMail({
      name: '<script>alert(1)</script> & Co',
      email: 'u@example.com',
      workspaceName: 'A & B',
      role: 'labeller',
      url: 'https://app/set-password#t=abc"x',
      hours: 72
    })
    expect(mail.html).not.toContain('<script>alert')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co')
    expect(mail.html).toContain('#t=abc&quot;x')
    expect(mail.text).toContain('<script>alert(1)</script> & Co')
  })

  it('keeps passwords and links out of the preheader', () => {
    const mail = credentialsMail({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'Zq9secretPw',
      workspaceName: 'W',
      role: 'labeller',
      signInUrl: 'https://app/login'
    })
    const preheader = /<div style="display:none[^>]*>([^<]*)<\/div>/.exec(mail.html)?.[1] ?? ''
    expect(preheader).toBe('Your classiflow account is ready.')
    expect(mail.html).toContain('Zq9secretPw')
    expect(mail.text).toContain('Temporary password: Zq9secretPw')
    expect(mail.subject).not.toContain('Zq9')
  })

  it('renders inline styles only, no style blocks or images', () => {
    const { html } = renderMail({ preheader: 'p', heading: 'h', blocks: [{ type: 'text', text: 't' }] })
    expect(html).not.toMatch(/<style|<img/)
  })
})
