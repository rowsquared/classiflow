// A stand-in for the n8n "E-MAIL API" workflow, for local development only.
// Accepts the webhook classiflow sends (lib/mail/n8n.ts) and prints the
// recipient, the subject and any classiflow link, never the rest of the body
// (sign-in details stay out of the terminal).
//
//   node scripts/mock-mail-webhook.mjs            # listens on port 4010
//   N8N_EMAIL_WEBHOOK_URL=http://localhost:4010/webhook/send-email
//   N8N_EMAIL_WEBHOOK_SECRET=dev-only-secret     # any value; checked below
//
// MOCK_MAIL_STATUS=500 makes it answer with that status, to try failures.
import { createServer } from 'node:http'

const port = Number(process.env.MOCK_MAIL_PORT || 4010)
const header = process.env.N8N_EMAIL_WEBHOOK_HEADER || 'send-email-api'
const secret = process.env.N8N_EMAIL_WEBHOOK_SECRET || ''
const status = Number(process.env.MOCK_MAIL_STATUS || 200)

createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => (raw += chunk))
  req.on('end', () => {
    if (secret && req.headers[header] !== secret) {
      console.log('✗ refused: wrong or missing secret header')
      res.writeHead(401).end()
      return
    }
    try {
      const { to, subject, body } = JSON.parse(raw)
      const links = [...String(body).matchAll(/href="([^"]*(?:set-password|invitation|login)[^"]*)"/g)].map(m =>
        m[1].replace(/&amp;/g, '&')
      )
      console.log(`✉ to: ${to}\n  subject: ${subject}`)
      for (const link of new Set(links)) console.log(`  link (dev only): ${link}`)
    } catch {
      console.log('✗ not JSON')
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end('{}')
  })
}).listen(port, () => console.log(`Mock mail webhook on http://localhost:${port}/webhook/send-email`))
