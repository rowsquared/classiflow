import { isSpanContextValid, trace } from '@opentelemetry/api'
import pino, { type Logger } from 'pino'
import { currentRequestId } from '@/lib/request-id'

/**
 * Server logs: one JSON object per line on stdout (pino), for the container
 * log collector. `LOG_LEVEL` sets the level (default `info`; `silent` in the
 * test suites unless set). Lines written during a request carry its
 * `requestId` (requestLogger/logError); with tracing on (lib/telemetry.ts)
 * they also carry the active `traceId` and `spanId`.
 *
 * Never log record contents, passwords, tokens, mail bodies or secrets. The
 * redaction below is a safety net for objects passed by mistake, not a
 * licence to log them: it only sees the key names listed, at the top level
 * and one level down (two for request headers).
 */

const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  '["set-cookie"]'
]
// Record contents (Sentence fields) and free text that may contain them.
const RECORD_KEYS = [
  'text',
  'field1',
  'field2',
  'field3',
  'field4',
  'field5',
  'support1',
  'support2',
  'support3',
  'support4',
  'support5',
  'body',
  'html'
]

export const REDACTED_PATHS = [
  ...[...SECRET_KEYS, ...RECORD_KEYS].flatMap(key => [key, `*.${key}`]),
  '*.headers.authorization',
  '*.headers.cookie'
]

function defaultLevel() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL
  return process.env.VITEST ? 'silent' : 'info'
}

export function createLogger(destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level: defaultLevel(),
      base: { service: 'classiflow', release: process.env.SOURCE_COMMIT || undefined },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: label => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      mixin: traceContext
    },
    destination
  )
}

function traceContext() {
  const context = trace.getActiveSpan()?.spanContext()
  return context && isSpanContextValid(context) ? { traceId: context.traceId, spanId: context.spanId } : {}
}

export const logger = createLogger()

/** A child logger carrying the current request's ID, if there is one. */
export async function requestLogger(bindings: Record<string, unknown> = {}): Promise<Logger> {
  const requestId = await currentRequestId()
  return logger.child(requestId ? { requestId, ...bindings } : bindings)
}

/**
 * Logs an error with the current request's ID. Use in route handlers'
 * catch blocks instead of console.error.
 */
export async function logError(message: string, error: unknown, fields: Record<string, unknown> = {}): Promise<void> {
  const log = await requestLogger()
  log.error({ ...fields, err: error }, message)
}
