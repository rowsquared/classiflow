import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NextRequest } from 'next/server'
import { resetMailConfig } from '@/lib/mail/config'

export type CapturedMail = { to: string; subject: string; body: string; secret: string | undefined }

/**
 * A stand-in for the n8n "E-MAIL API" workflow on a local port: records each
 * message and answers with `status` (200 unless a test changes it).
 */
export async function startMailWebhook() {
  const mails: CapturedMail[] = []
  const state = { status: 200, delayMs: 0 }
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const payload = JSON.parse(raw) as { to: string; subject: string; body: string }
      mails.push({ ...payload, secret: req.headers['send-email-api'] as string | undefined })
      setTimeout(() => {
        res.writeHead(state.status, { 'content-type': 'application/json' })
        res.end('{}')
      }, state.delayMs)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    mails,
    state,
    url: `http://127.0.0.1:${port}/webhook/send-email`,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}

/** Mail on, pointed at the local webhook. */
export function enableMail(webhookUrl: string) {
  process.env.N8N_EMAIL_WEBHOOK_SECRET = 'test-webhook-secret'
  process.env.N8N_EMAIL_WEBHOOK_URL = webhookUrl
  process.env.N8N_EMAIL_WEBHOOK_TIMEOUT = '2'
  process.env.APP_BASE_URL = 'https://classiflow.test'
  resetMailConfig()
}

export function disableMail() {
  delete process.env.N8N_EMAIL_WEBHOOK_SECRET
  resetMailConfig()
}

/** The token from a link in a mail body (`...#t=<token>`). */
export function tokenFrom(mail: CapturedMail | undefined): string {
  const match = /#t=([A-Za-z0-9_.-]+)/.exec(mail?.body ?? '')
  if (!match) throw new Error('No link in the mail')
  return match[1]!
}

let ip = 0

/** A JSON request from its own client address, so rate limits do not interfere. */
export function publicRequest(url: string, body: unknown, address = `10.0.${Math.floor(++ip / 250)}.${ip % 250}`) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address }
  })
}
