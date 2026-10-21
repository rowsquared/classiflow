import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from './logger'

function capture() {
  const lines: Record<string, unknown>[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)))
      done()
    }
  })
  const log = createLogger(stream)
  log.level = 'info'
  return { log, lines }
}

describe('logger', () => {
  it('writes JSON with a level label, service and message', () => {
    const { log, lines } = capture()
    log.info({ jobId: 'j1' }, 'job started')
    expect(lines[0]).toMatchObject({ level: 'info', service: 'classiflow', jobId: 'j1', msg: 'job started' })
    expect(typeof lines[0]?.time).toBe('string')
  })

  it('redacts secrets and record contents passed by mistake', () => {
    const { log, lines } = capture()
    log.warn(
      {
        password: 'hunter2hunter2',
        user: { password: 'x', token: 't', name: 'kept' },
        headers: { authorization: 'Bearer abc', cookie: 'session=1', accept: 'text/html' },
        sentence: { id: 's1', field1: 'private answer', support2: 'context' },
        text: 'free text'
      },
      'oops'
    )
    const line = JSON.stringify(lines[0])
    for (const secret of ['hunter2hunter2', 'Bearer abc', 'session=1', 'private answer', 'context', 'free text']) {
      expect(line).not.toContain(secret)
    }
    expect(lines[0]).toMatchObject({ user: { name: 'kept' }, headers: { accept: 'text/html' }, sentence: { id: 's1' } })
  })

  it('serialises errors with their message and stack', () => {
    const { log, lines } = capture()
    log.error({ err: new Error('boom') }, 'failed')
    expect(lines[0]).toMatchObject({ msg: 'failed', err: { type: 'Error', message: 'boom' } })
    expect(String((lines[0]?.err as { stack: string }).stack)).toContain('boom')
  })
})
