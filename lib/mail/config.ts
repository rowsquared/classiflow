/**
 * Outgoing email settings (ENV_SETUP.md "Email"), read once per process.
 * Mail is sent through the rowsquared "E-MAIL API" n8n workflow, which owns
 * the SMTP credentials; there is no SMTP transport and no console transport
 * (credentials and links must never end up in a log).
 *
 * Mail is on when N8N_EMAIL_WEBHOOK_SECRET and a public base URL are both set.
 * The base URL (APP_BASE_URL, else BETTER_AUTH_URL) goes into every link and is
 * never taken from the request's Host header.
 */

export type MailConfig = {
  transport: 'n8n' | 'off'
  webhookUrl: string
  webhookHeader: string
  webhookSecret: string
  /** Bound on one delivery: the workflow answers after its SMTP send. */
  timeoutMs: number
  /** Public URL for links, without a trailing slash; null when unknown. */
  baseUrl: string | null
  invitationHours: number
  passwordLinkMinutes: number
}

const DEFAULT_WEBHOOK_URL = 'https://n8n.rowsquared.com/webhook/send-email'

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

type Env = Record<string, string | undefined>

function baseUrlFrom(env: Env): string | null {
  const raw = (env.APP_BASE_URL || env.BETTER_AUTH_URL || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function readMailConfig(env: Env = process.env): MailConfig {
  const secret = env.N8N_EMAIL_WEBHOOK_SECRET?.trim() || ''
  const baseUrl = baseUrlFrom(env)
  return {
    transport: secret && baseUrl ? 'n8n' : 'off',
    webhookUrl: env.N8N_EMAIL_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL,
    webhookHeader: env.N8N_EMAIL_WEBHOOK_HEADER?.trim() || 'send-email-api',
    webhookSecret: secret,
    timeoutMs: positive(env.N8N_EMAIL_WEBHOOK_TIMEOUT, 15) * 1000,
    baseUrl,
    invitationHours: positive(env.INVITATION_LINK_HOURS, 72),
    passwordLinkMinutes: positive(env.PASSWORD_RESET_LINK_MINUTES, 60)
  }
}

let cached: MailConfig | null = null

export function mailConfig(): MailConfig {
  cached ??= readMailConfig()
  return cached
}

/** Tests change the environment between cases. */
export function resetMailConfig() {
  cached = null
}

/** The single gate every caller checks before offering or sending mail. */
export function mailEnabled(): boolean {
  return mailConfig().transport !== 'off'
}

/** What admins may see: no secret, no header name. */
export function mailStatus() {
  const config = mailConfig()
  return { enabled: config.transport !== 'off', transport: config.transport, baseUrl: config.baseUrl }
}
