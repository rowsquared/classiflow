import { describe, expect, it } from 'vitest'
import { creationOrder, MEMBER_IMPORT_TEMPLATE, parseMemberCsv } from './member-import'

const HEADER = 'username,email,name,role,supervisor,access,password'
const parse = (body: string, mailEnabled = true) => parseMemberCsv(`${HEADER}\n${body}`, { mailEnabled })

describe('parseMemberCsv', () => {
  it('accepts the template', () => {
    const result = parseMemberCsv(MEMBER_IMPORT_TEMPLATE, { mailEnabled: true })
    expect(result.fileErrors).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.rows.map(r => [r.username, r.access, r.supervisor])).toEqual([
      ['maria', 'invite', null],
      ['ahmed', 'email_password', 'maria'],
      ['wei', 'generate', 'maria'],
      // An existing account: username and access stay empty.
      ['', null, 'maria']
    ])
  })

  it('leaves username, name and access to the server, which needs them only for new accounts', () => {
    const result = parse(['a1x,a1@x.org,A,supervisor,,generate,', ',a2@x.org,,labeller,a1x,,'].join('\n'))
    expect(result.errors).toEqual([])
    expect(result.rows[1]).toMatchObject({ username: '', name: '', access: null, supervisor: 'a1x' })
    expect(creationOrder([...result.rows].reverse()).map(r => r.line)).toEqual([2, 3])
  })

  it('handles a BOM, CRLF, quoted commas and multi-line cells with correct line numbers', () => {
    const text = `﻿${HEADER}\r\nana,ana@x.org,"Rossi, Ana",labeller,,generate,\r\nbob,bob@x.org,"Bob\r\nSecond line",labeller,,generate,\r\n,bad,,,,,\r\n`
    const result = parseMemberCsv(text, { mailEnabled: false })
    expect(result.fileErrors).toEqual([])
    expect(result.rows[0]!.name).toBe('Rossi, Ana')
    expect(result.rows.map(r => r.line)).toEqual([2, 3, 5])
    expect(result.errors.every(e => e.line === 5)).toBe(true)
    expect(result.errors.map(e => e.field)).toEqual(expect.arrayContaining(['email', 'role']))
  })

  it('lowercases usernames and emails and keeps passwords untrimmed', () => {
    const result = parse('Maria,Maria@X.org,Maria,Labeller,,password, kettle-orbit-blue ')
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      username: 'maria',
      displayUsername: 'Maria',
      email: 'maria@x.org',
      role: 'labeller',
      password: ' kettle-orbit-blue '
    })
  })

  it('reports missing, unknown and duplicate headers', () => {
    expect(parseMemberCsv('username,email,name,role,access,password,extra', { mailEnabled: true }).fileErrors).toEqual([
      'Unknown columns: extra',
      'Missing columns: supervisor'
    ])
    expect(parseMemberCsv(`${HEADER},email\n`, { mailEnabled: true }).fileErrors[0]).toMatch(/Duplicate columns: email/)
  })

  it('refuses empty files and too many rows', () => {
    expect(parseMemberCsv(`${HEADER}\n\n`, { mailEnabled: true }).fileErrors).toEqual(['The file has no members'])
    const many = Array.from({ length: 501 }, (_, i) => `u${i}x,u${i}@x.org,U,labeller,,generate,`).join('\n')
    expect(parse(many).fileErrors).toEqual(['At most 500 members per file'])
  })

  it('checks access values, mail and passwords', () => {
    const result = parse(
      [
        'a1x,a1@x.org,A,labeller,,maybe,',
        'a2x,a2@x.org,A,labeller,,invite,',
        'a3x,a3@x.org,A,labeller,,password,',
        'a4x,a4@x.org,A,labeller,,password,password123',
        'a5x,a5@x.org,A,labeller,,generate,not-allowed-here'
      ].join('\n'),
      false
    )
    expect(result.errors.map(e => [e.line, e.field])).toEqual([
      [2, 'access'],
      [3, 'access'],
      [4, 'password'],
      [5, 'password'],
      [6, 'password']
    ])
  })

  it('rejects every row of an in-file collision, also case-only ones', () => {
    const result = parse(['ana,a@x.org,A,labeller,,generate,', 'ANA,b@x.org,B,labeller,,generate,'].join('\n'))
    expect(result.errors.map(e => e.line)).toEqual([2, 3])
  })

  it('checks supervisors in the file: role and cycles', () => {
    const result = parse(
      [
        'boss,boss@x.org,B,supervisor,deputy,generate,',
        'deputy,deputy@x.org,D,supervisor,boss,generate,',
        'lab,lab@x.org,L,labeller,,generate,',
        'other,other@x.org,O,labeller,lab,generate,'
      ].join('\n')
    )
    expect(result.errors.map(e => [e.line, e.message])).toEqual([
      [2, 'The supervisors in this file form a cycle'],
      [3, 'The supervisors in this file form a cycle'],
      [5, 'The supervisor must be an admin or supervisor']
    ])
  })
})

describe('creationOrder', () => {
  it('puts supervisors from the file before their reports', () => {
    const { rows } = parse(
      [
        'lab,lab@x.org,L,labeller,mid,generate,',
        'mid,mid@x.org,M,supervisor,top,generate,',
        'top,top@x.org,T,admin,,generate,'
      ].join('\n')
    )
    expect(creationOrder(rows).map(r => r.username)).toEqual(['top', 'mid', 'lab'])
  })
})
