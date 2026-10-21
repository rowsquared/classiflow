import { mailConfig } from './config'
import { sendViaN8n, type MailMessage, type MailOutcome } from './n8n'

export { mailEnabled } from './config'
export type { MailMessage, MailOutcome } from './n8n'

type Transport = (message: MailMessage) => Promise<MailOutcome>

let override: Transport | null = null

/** Unit tests replace the transport; integration tests use a local webhook. */
export function setMailTransport(transport: Transport | null) {
  override = transport
}

export async function sendMail(message: MailMessage): Promise<MailOutcome> {
  if (override) return override(message)
  const config = mailConfig()
  if (config.transport === 'off') return { outcome: 'failed', detail: 'Email is not configured' }
  return sendViaN8n(config, message)
}
