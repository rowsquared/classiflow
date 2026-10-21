import type { MailConfig } from './config'

export type MailMessage = { to: string; subject: string; html: string; text: string }

/**
 * sent: accepted (2xx). failed: a definite refusal (4xx: wrong secret, bad
 * payload), so sending again is safe. unknown: timeout, network error or a
 * server error; the workflow may already have sent it, so it is never
 * reported as failed and never resent automatically.
 */
export type MailOutcome = { outcome: 'sent' | 'failed' | 'unknown'; detail?: string }

/** One line, so a header cannot be injected and clients show it whole. */
export function foldSubject(subject: string): string {
  return subject
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)
}

export function outcomeForStatus(status: number): MailOutcome['outcome'] {
  if (status >= 200 && status < 300) return 'sent'
  if (status >= 400 && status < 500) return 'failed'
  return 'unknown'
}

/**
 * Posts one message to the n8n workflow: `{ to, subject, body }` with `body`
 * as HTML, authenticated by the secret header. The workflow fixes the sender;
 * there is no from, cc, bcc or attachment. Never logs the payload or secret,
 * and never quotes the reply (it could echo the message).
 */
export async function sendViaN8n(
  config: MailConfig,
  message: MailMessage,
  fetchImpl: typeof fetch = fetch
): Promise<MailOutcome> {
  let response: Response
  try {
    response = await fetchImpl(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [config.webhookHeader]: config.webhookSecret },
      body: JSON.stringify({ to: message.to, subject: foldSubject(message.subject), body: message.html }),
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: 'error'
    })
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return {
      outcome: 'unknown',
      detail: timeout ? 'No answer from the mail service in time' : 'Mail service unreachable'
    }
  }
  const outcome = outcomeForStatus(response.status)
  await response.body?.cancel().catch(() => undefined)
  if (outcome === 'sent') return { outcome }
  return {
    outcome,
    detail:
      outcome === 'failed'
        ? `The mail service refused the message (HTTP ${response.status})`
        : `The mail service failed (HTTP ${response.status}); the message may have been sent`
  }
}
