// Seeds a demo workspace: a labour force survey coded to ISCO-08 (occupation)
// and ISIC Rev.4 (industry), with a team, six weeks of labelling history,
// comments, flags and AI suggestions. Meant for staging and local demos.
//
//   node scripts/seed-demo.ts            seed unless the demo workspace exists
//   node scripts/seed-demo.ts --reset    delete the demo workspace and seed it again
//   node scripts/seed-demo.ts --csv dir  only write the taxonomies and records as
//                                        importable CSV files into dir (no database)
//
// scripts/start.sh runs it when DEMO_SEED is true (or reset, which rebuilds the
// workspace on every start). It needs the schema owner's DATABASE_URL: workspace
// row security would stop the runtime role from writing into a new workspace.
// It touches only the workspace "demo-lfs" and the demo.* accounts, never
// other workspaces or users. Everything runs in one transaction, so a failure
// leaves nothing behind.
//
// Demo accounts (demo.grace, demo.amina, ...; addresses @example.com) get
// DEMO_PASSWORD when it is set; without it they exist but cannot sign in.
// Platform admins become admins of the workspace. Dates are relative to the
// time of seeding, so a reset brings the progress dashboard back to "now".
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './lib/db.ts'
import { hashPassword, setPasswordHash } from '../lib/passwords.ts'
import { passwordProblem } from '../lib/password-policy.ts'
import { ISCO08, ISCO08_DEFINITIONS, ISCO08_LEVEL_NAMES } from './demo/isco08.ts'
import { ISIC4, ISIC4_DEFINITIONS, ISIC4_LEVEL_NAMES } from './demo/isic4.ts'
import { AGE_GROUPS, PROFILES, REGIONS, SEXES, VAGUE, type Profile } from './demo/profiles.ts'
import type { Prisma } from '../lib/generated/prisma/client.ts'

const WORKSPACE_ID = 'demo-lfs'
const RECORDS = [2000, 1000] // two imports: Q1-Q2 and Q3
const DAY = 86_400_000
const MINUTE = 60_000
const UNKNOWN = ['-9', '-99', '-999', '-9999', '-99999'] // lib/constants.ts, by level
// Africa/Nairobi (UTC+3): the working day 08:00-17:00 local is 05:00-14:00 UTC.
const TIME_ZONE = 'Africa/Nairobi'
const WORKDAY_START_UTC = 5 * 60
const WORKDAY_MINUTES = 9 * 60

type Tx = Prisma.TransactionClient

// Deterministic randomness: the records come from their own stream, so the
// CSV export and the database hold the same text.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function tools(seed: number) {
  const rand = random(seed)
  return {
    rand,
    chance: (p: number) => rand() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!,
    between: (low: number, high: number) => low + rand() * (high - low)
  }
}

// --- Taxonomies -------------------------------------------------------------

type TaxNode = { code: string; label: string; level: number; parentCode: string | null; definition: string | null }

function lines(text: string): Array<[string, string]> {
  return text
    .trim()
    .split('\n')
    .map(line => {
      const space = line.indexOf(' ')
      return [line.slice(0, space), line.slice(space + 1)]
    })
}

const iscoNodes: TaxNode[] = lines(ISCO08).map(([code, label]) => ({
  code,
  label,
  level: code.length,
  parentCode: code.length > 1 ? code.slice(0, -1) : null,
  definition: ISCO08_DEFINITIONS[code] ?? null
}))

const sectionOf = new Map<string, string>()
const isicNodes: TaxNode[] = []
{
  let section = ''
  for (const [code, label] of lines(ISIC4)) {
    const isSection = /^[A-Z]$/.test(code)
    if (isSection) section = code
    else sectionOf.set(code, section)
    isicNodes.push({
      code,
      label,
      level: isSection ? 1 : 2,
      parentCode: isSection ? null : section,
      definition: ISIC4_DEFINITIONS[code] ?? null
    })
  }
}

const parents = (nodes: TaxNode[]) => new Set(nodes.map(n => n.parentCode).filter(Boolean))
const iscoParents = parents(iscoNodes)
const isicParents = parents(isicNodes)
const iscoLeaves = iscoNodes.filter(n => !iscoParents.has(n.code)).map(n => n.code)
const isicLeaves = isicNodes.filter(n => !isicParents.has(n.code)).map(n => n.code)

/** Codes per level, from level 1 down; an incomplete path ends in the next level's unknown code. */
function iscoPath(code: string): string[] {
  const known = Array.from({ length: code.length }, (_, i) => code.slice(0, i + 1))
  return code.length === 4 ? known : [...known, UNKNOWN[code.length]!]
}
function isicPath(code: string): string[] {
  if (code === '') return [UNKNOWN[0]!]
  if (/^[A-Z]$/.test(code)) return [code, UNKNOWN[1]!]
  return [sectionOf.get(code)!, code]
}

// --- Records ----------------------------------------------------------------

type DemoRecord = {
  key: string
  batch: number
  order: number
  field1: string
  field2: string | null
  field3: string | null
  supports: string[]
  isco: string // a unit group, or the prefix a coder can defend for vague answers
  isic: string // a division, a section letter, or ''
  vague: boolean
  title: string
}

const FIELD_MAPPING = { '1': 'job_title', '2': 'main_tasks', '3': 'workplace_activity' }
const SUPPORT_MAPPING = { '1': 'region', '2': 'sex', '3': 'age_group', '4': 'employment_status', '5': 'interview_mode' }
// Labour force surveys have many more elementary, sales and farm workers than managers.
const MAJOR_WEIGHT: Record<string, number> = {
  '0': 0.3,
  '1': 0.6,
  '2': 1,
  '3': 1,
  '4': 1.3,
  '5': 3,
  '6': 3,
  '7': 2.2,
  '8': 2,
  '9': 3
}

function buildRecords(): DemoRecord[] {
  const { rand, chance, pick } = tools(2026)
  const weights = PROFILES.map(p => MAJOR_WEIGHT[p.isco[0]!]!)
  const total = weights.reduce((a, b) => a + b, 0)
  const pickProfile = (): Profile => {
    let r = rand() * total
    for (let i = 0; i < PROFILES.length; i++) {
      r -= weights[i]!
      if (r <= 0) return PROFILES[i]!
    }
    return PROFILES[PROFILES.length - 1]!
  }
  const typo = (text: string) => {
    const words = text.split(' ')
    const candidates = words.map((w, i) => (w.length > 4 ? i : -1)).filter(i => i >= 0)
    if (candidates.length === 0) return text
    const i = pick(candidates)
    const word = words[i]!
    const at = 1 + Math.floor(rand() * (word.length - 2))
    words[i] = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2)
    return words.join(' ')
  }
  const roughen = (text: string) => {
    const r = rand()
    let out = r < 0.04 ? text.toUpperCase() : r < 0.35 ? text[0]!.toUpperCase() + text.slice(1) : text
    if (chance(0.03)) out = typo(out)
    return out
  }

  const records: DemoRecord[] = []
  for (const [batch, count] of RECORDS.entries()) {
    let household = 0
    let person = 0
    for (let order = 1; order <= count; order++) {
      if (person === 0 || chance(0.55)) {
        household++
        person = 0
      }
      person++
      const quarter = batch === 1 ? 'Q3' : order <= count / 2 ? 'Q1' : 'Q2'
      const key = `LFS26-${quarter}-${String(household).padStart(5, '0')}-${String(person).padStart(2, '0')}`
      const supports = [pick(REGIONS), pick(SEXES), pick(AGE_GROUPS), 'Employee', chance(0.8) ? 'CAPI' : 'CATI']

      if (chance(0.04)) {
        const v = pick(VAGUE)
        supports[3] = chance(0.5) ? 'Own-account worker' : 'Employee'
        records.push({
          key,
          batch,
          order,
          field1: v.title,
          field2: v.tasks,
          field3: v.place,
          supports,
          isco: v.isco,
          isic: v.isic,
          vague: true,
          title: v.title
        })
        continue
      }

      const p = pickProfile()
      const [isic, place] = pick(p.places)
      if (chance(p.selfEmployed ?? 0.01)) {
        supports[3] =
          isic === '01' || isic === '47'
            ? chance(0.2)
              ? 'Contributing family worker'
              : 'Own-account worker'
            : chance(0.15)
              ? 'Employer'
              : 'Own-account worker'
      }
      const title = pick(p.titles)
      let field1 = roughen(title)
      if (chance(0.03)) field1 += pick([' (part time)', ' - casual', ', temporary', ' on contract'])
      const tasks = chance(0.08) ? null : roughen(pick(p.tasks))
      const workplace = chance(0.04) ? null : chance(0.03) ? "don't know" : roughen(place)
      records.push({
        key,
        batch,
        order,
        field1,
        field2: tasks,
        field3: workplace,
        supports,
        isco: p.isco,
        isic,
        vague: false,
        title
      })
    }
  }
  return records
}

// --- People -----------------------------------------------------------------

type Person = {
  key: string
  name: string
  role: 'admin' | 'supervisor' | 'labeller'
  supervisor?: string
  /** Share of their Q1-Q2 records labelled by now. */
  pace?: number
  /** Suspended this many days ago; labelled until then. */
  leftDaysAgo?: number
}

const PEOPLE: Person[] = [
  { key: 'grace', name: 'Grace Mensah', role: 'admin' },
  { key: 'amina', name: 'Amina Okafor', role: 'supervisor' },
  { key: 'lukas', name: 'Lukas Weber', role: 'supervisor' },
  { key: 'sofia', name: 'Sofia Martins', role: 'labeller', supervisor: 'amina', pace: 0.96 },
  { key: 'daniel', name: 'Daniel Kim', role: 'labeller', supervisor: 'amina', pace: 0.84 },
  { key: 'priya', name: 'Priya Nair', role: 'labeller', supervisor: 'amina', pace: 0.9 },
  { key: 'tomas', name: 'Tomás Rivera', role: 'labeller', supervisor: 'amina', pace: 0.58 },
  { key: 'hannah', name: 'Hannah Schulz', role: 'labeller', supervisor: 'lukas', pace: 0.8 },
  { key: 'yusuf', name: 'Yusuf Demir', role: 'labeller', supervisor: 'lukas', pace: 0.71 },
  { key: 'mei', name: 'Mei Chen', role: 'labeller', supervisor: 'lukas', pace: 0.88 },
  { key: 'olivia', name: 'Olivia Brown', role: 'labeller', supervisor: 'lukas', pace: 0.55, leftDaysAgo: 18 }
]
const LABELLERS = PEOPLE.filter(p => p.role === 'labeller')
const username = (p: Person) => `demo.${p.key}`

// --- Comments ---------------------------------------------------------------

const VAGUE_NOTES = [
  'Too vague to code beyond what is there. Can the field team call back?',
  'The job title alone does not say what the occupation is; left unknown for now.',
  'No usable workplace description, so ISIC stays unknown.',
  'Two jobs in one answer: which one is the main job?'
]
const VAGUE_REPLIES = [
  'Agreed, keep it unknown and leave the flag on.',
  'I have asked the field team for a call-back.',
  'Code the main job only, the one with the most hours.',
  'Fine as it is. Unknown is the right answer here.'
]
const QUESTIONS = [
  (r: DemoRecord) => `Title says "${r.title}" but the tasks read like a different unit group. I coded from the tasks.`,
  () => 'Self-employed, but the answer mentions employees. Employer or own-account worker?',
  () => 'Is this a supervisor or a worker? The answer mentions both.',
  () => 'The workplace description is generic, so I coded the industry from the tasks.'
]
const ANSWERS = [
  'Tasks take precedence over the title, so that is correct.',
  'Correct, the main activity rule applies.',
  'Please check the definition of the minor group, I think it fits one level up.',
  'Good catch. Keep it as it is.'
]

// --- Seeding ----------------------------------------------------------------

function chunks<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Deletes every row of the demo workspace, children before parents (from the foreign keys). */
async function deleteWorkspace(tx: Tx) {
  const scoped = await tx.$queryRaw<Array<{ table: string }>>`
    SELECT table_name AS table FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'workspaceId'`
  const keys = await tx.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`
  const bare = (name: string) => name.replace(/^public\./, '').replace(/"/g, '')
  const remaining = new Set(scoped.map(s => s.table))
  const order: string[] = []
  while (remaining.size > 0) {
    // A table can go once no other remaining table points at it.
    const next = [...remaining].filter(
      t => !keys.some(k => bare(k.parent) === t && bare(k.child) !== t && remaining.has(bare(k.child)))
    )
    if (next.length === 0) throw new Error(`Cannot order the deletes for: ${[...remaining].join(', ')}`)
    for (const t of next) {
      order.push(t)
      remaining.delete(t)
    }
  }
  for (const table of order) {
    await tx.$executeRawUnsafe(`DELETE FROM "public"."${table}" WHERE "workspaceId" = $1`, WORKSPACE_ID)
  }
  await tx.$executeRawUnsafe(`DELETE FROM "public"."Workspace" WHERE id = $1`, WORKSPACE_ID)
}

async function seed(tx: Tx, passwordHash: string | null, reset: boolean) {
  const { rand, chance, pick, between } = tools(7)
  const now = Date.now()
  const at = (ms: number) => new Date(Math.min(ms, now - MINUTE))
  const daysAgo = (days: number) => now - days * DAY

  // People: demo accounts are reused when they exist (a reset keeps them).
  const userId = new Map<string, string>()
  for (const p of PEOPLE) {
    const existing = await tx.user.findUnique({ where: { username: username(p) }, select: { id: true } })
    const id =
      existing?.id ??
      (
        await tx.user.create({
          data: {
            username: username(p),
            displayUsername: username(p),
            email: `${username(p)}@example.com`,
            name: p.name,
            mustResetPassword: false,
            createdAt: new Date(daysAgo(47))
          },
          select: { id: true }
        })
      ).id
    if (passwordHash && (!existing || reset)) await setPasswordHash(tx, id, passwordHash)
    userId.set(p.key, id)
  }
  const uid = (key: string) => userId.get(key)!
  const grace = uid('grace')

  await tx.workspace.create({
    data: {
      id: WORKSPACE_ID,
      name: 'Labour Force Survey 2026 (demo)',
      description:
        'Demo data: occupations coded to ISCO-08 and industries to ISIC Rev.4. Seeded by scripts/seed-demo.ts.',
      reportingTimezone: TIME_ZONE,
      activityTrackedSince: new Date(daysAgo(60)),
      createdById: grace,
      createdAt: new Date(daysAgo(47))
    }
  })

  const memberId = (key: string) => `demo_m_${key}`
  const admins = await tx.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  await tx.workspaceMembership.createMany({
    data: admins.map((a, i) => ({
      id: `demo_m_platform${i}`,
      workspaceId: WORKSPACE_ID,
      userId: a.id,
      role: 'admin' as const,
      lastSeenAt: new Date(daysAgo(2))
    }))
  })
  // Supervisors first: labellers point at them.
  for (const group of [PEOPLE.filter(p => !p.supervisor), PEOPLE.filter(p => p.supervisor)]) {
    await tx.workspaceMembership.createMany({
      data: group.map(p => ({
        id: memberId(p.key),
        workspaceId: WORKSPACE_ID,
        userId: uid(p.key),
        role: p.role,
        status: p.leftDaysAgo ? ('suspended' as const) : ('active' as const),
        supervisorMembershipId: p.supervisor ? memberId(p.supervisor) : null,
        lastSeenAt: new Date(p.leftDaysAgo ? daysAgo(p.leftDaysAgo) : now - between(0.2, 30) * 3_600_000),
        addedById: p.key === 'grace' ? null : grace,
        createdAt: new Date(daysAgo(46))
      }))
    })
  }

  // Taxonomies, with the profiles' job titles as ISCO synonyms for search.
  const taxonomies = [
    {
      id: 'demo_t_isco',
      key: 'ISCO08',
      nodes: iscoNodes,
      maxDepth: 4,
      levelNames: ISCO08_LEVEL_NAMES,
      description: 'ISCO-08, International Standard Classification of Occupations (ILO)'
    },
    {
      id: 'demo_t_isic',
      key: 'ISIC4',
      nodes: isicNodes,
      maxDepth: 2,
      levelNames: ISIC4_LEVEL_NAMES,
      description: 'ISIC Rev.4, International Standard Industrial Classification, to division level (UN)'
    }
  ]
  const synonyms = new Map<string, Set<string>>()
  for (const p of PROFILES)
    for (const t of p.titles) (synonyms.get(p.isco) ?? synonyms.set(p.isco, new Set()).get(p.isco)!).add(t)
  for (const t of taxonomies) {
    await tx.taxonomy.create({
      data: {
        id: t.id,
        workspaceId: WORKSPACE_ID,
        key: t.key,
        description: t.description,
        levelNames: t.levelNames,
        maxDepth: t.maxDepth,
        createdById: grace,
        createdAt: new Date(daysAgo(46))
      }
    })
    const hasChildren = parents(t.nodes)
    const pathOf = (code: string): string => {
      const parent = t.nodes.find(n => n.code === code)?.parentCode
      return parent ? `${pathOf(parent)}.${code}` : code
    }
    await tx.taxonomyNode.createMany({
      data: t.nodes.map(n => ({
        id: `${t.id}_${n.code}`,
        workspaceId: WORKSPACE_ID,
        taxonomyId: t.id,
        code: n.code,
        label: n.label,
        level: n.level,
        parentCode: n.parentCode,
        definition: n.definition,
        path: pathOf(n.code),
        isLeaf: !hasChildren.has(n.code)
      }))
    })
    if (t.key === 'ISCO08') {
      await tx.taxonomySynonym.createMany({
        data: [...synonyms].flatMap(([code, titles]) =>
          [...titles].map(synonym => ({
            workspaceId: WORKSPACE_ID,
            taxonomyId: t.id,
            nodeId: `${t.id}_${code}`,
            synonym
          }))
        )
      })
    }
  }

  // Records in two imports: Q1-Q2 six weeks ago, Q3 last week.
  const records = buildRecords()
  const importIds = ['demo_imp_q1q2', 'demo_imp_q3']
  const importedAt = [daysAgo(45), daysAgo(6)]
  await tx.sentenceImport.createMany({
    data: [
      {
        id: importIds[0]!,
        workspaceId: WORKSPACE_ID,
        fileName: 'lfs-2026-q1-q2.csv',
        uploadedAt: new Date(importedAt[0]!),
        uploadedById: grace,
        totalRows: RECORDS[0]!
      },
      {
        id: importIds[1]!,
        workspaceId: WORKSPACE_ID,
        fileName: 'lfs-2026-q3.csv',
        uploadedAt: new Date(importedAt[1]!),
        uploadedById: grace,
        totalRows: RECORDS[1]!
      }
    ]
  })
  const sentenceId = (r: DemoRecord) => `demo_s_${r.batch + 1}_${r.order}`

  // Assignments: Q1-Q2 round robin over all labellers; the first 400 of Q3 to
  // Amina's team; the rest of Q3 is still unassigned.
  const assignee = new Map<DemoRecord, Person>()
  const q3Team = LABELLERS.filter(l => l.supervisor === 'amina')
  for (const r of records) {
    if (r.batch === 0) assignee.set(r, LABELLERS[(r.order - 1) % LABELLERS.length]!)
    else if (r.order <= 400) assignee.set(r, q3Team[(r.order - 1) % q3Team.length]!)
  }
  const assignments = [...assignee].map(([r, l]) => ({
    workspaceId: WORKSPACE_ID,
    sentenceId: sentenceId(r),
    membershipId: memberId(l.key),
    assignedAt: new Date(importedAt[r.batch]! + DAY),
    assignedBy: grace
  }))

  // Labelling times: spread over working hours on weekdays, up to now.
  const workdays = (fromDaysAgo: number, toDaysAgo: number) => {
    const days: Array<{ start: number; minutes: number }> = []
    for (let d = fromDaysAgo; d >= toDaysAgo; d--) {
      const midnight = Math.floor(daysAgo(d) / DAY) * DAY
      const weekday = new Date(midnight).getUTCDay()
      if (weekday === 0 || weekday === 6) continue
      const start = midnight + WORKDAY_START_UTC * MINUTE
      const minutes = Math.min(WORKDAY_MINUTES, (now - 5 * MINUTE - start) / MINUTE)
      if (minutes > 0) days.push({ start, minutes })
    }
    return days
  }
  const spread = (count: number, fromDaysAgo: number, toDaysAgo: number) => {
    const days = workdays(fromDaysAgo, toDaysAgo)
    const total = days.reduce((sum, d) => sum + d.minutes, 0)
    const step = total / Math.max(count, 1)
    return Array.from({ length: count }, (_, j) => {
      let offset = j * step + rand() * step * 0.8
      for (const day of days) {
        if (offset < day.minutes) return day.start + offset * MINUTE
        offset -= day.minutes
      }
      return now - 5 * MINUTE
    })
  }

  type Annotation = Prisma.SentenceAnnotationCreateManyInput
  type Activity = Prisma.LabelingActivityCreateManyInput
  type CommentRow = Prisma.CommentCreateManyInput
  const annotations = new Map<string, Annotation[]>() // by record and taxonomy: a later save replaces
  const activity: Activity[] = []
  const comments: CommentRow[] = []
  const sentenceState = new Map<
    DemoRecord,
    { status: 'pending' | 'submitted' | 'skipped' | 'escalated'; flagged: boolean; editor?: string; editedAt?: number }
  >()
  const labelled = { ISCO08: 0, ISIC4: 0 }
  let operation = 0

  const iscoSibling = (code: string) => {
    const near = iscoLeaves.filter(c => c !== code && c.startsWith(code.slice(0, 3)))
    return near.length > 0
      ? pick(near)
      : pick(iscoLeaves.filter(c => c !== code && c.startsWith(code.slice(0, 2))).concat(pick(iscoLeaves)))
  }
  const isicSibling = (code: string) => {
    const near = isicLeaves.filter(c => c !== code && sectionOf.get(c) === sectionOf.get(code))
    return near.length > 0 ? pick(near) : pick(isicLeaves.filter(c => c !== code))
  }
  const save = (
    r: DemoRecord,
    taxonomyId: string,
    path: string[],
    actor: string,
    time: number,
    startedAt: number | null
  ) => {
    const sid = sentenceId(r)
    annotations.set(
      `${sid} ${taxonomyId}`,
      path.map((code, i) => ({
        workspaceId: WORKSPACE_ID,
        sentenceId: sid,
        taxonomyId,
        level: i + 1,
        nodeCode: code,
        source: 'user' as const,
        createdById: actor,
        labelingStartedAt: startedAt ? new Date(startedAt) : null,
        createdAt: new Date(time),
        updatedAt: new Date(time)
      }))
    )
    activity.push({
      workspaceId: WORKSPACE_ID,
      sentenceId: sid,
      taxonomyId,
      actorId: actor,
      operationId: `demo-op-${++operation}`,
      createdAt: new Date(time)
    })
  }
  const thread = (r: DemoRecord, author: string, body: string, time: number, replier: string, reply: string) => {
    comments.push({
      workspaceId: WORKSPACE_ID,
      sentenceId: sentenceId(r),
      authorId: author,
      body,
      createdAt: new Date(time)
    })
    if (!chance(0.75)) return
    const answered = at(time + between(0.5, 30) * 3_600_000)
    const resolved = chance(0.55)
    comments.push({
      workspaceId: WORKSPACE_ID,
      sentenceId: sentenceId(r),
      authorId: replier,
      body: reply,
      createdAt: answered,
      resolved,
      resolvedAt: resolved ? answered : null
    })
    if (resolved)
      comments[comments.length - 2] = { ...comments[comments.length - 2]!, resolved: true, resolvedAt: answered }
  }

  const label = (r: DemoRecord, l: Person, time: number) => {
    const actor = uid(l.key)
    const supervisor = uid(l.supervisor!)
    const startedAt = time - between(40, 400) * 1000
    const state = {
      status: 'submitted' as 'pending' | 'submitted' | 'skipped' | 'escalated',
      flagged: false,
      editor: actor,
      editedAt: time
    }
    sentenceState.set(r, state)

    if (r.vague) {
      save(r, 'demo_t_isco', iscoPath(r.isco), actor, time, startedAt)
      save(r, 'demo_t_isic', isicPath(r.isic), actor, time + between(15, 90) * 1000, null)
      labelled.ISCO08++
      labelled.ISIC4++
      state.flagged = true
      if (chance(0.3)) state.status = 'escalated'
      thread(r, actor, pick(VAGUE_NOTES), time, supervisor, pick(VAGUE_REPLIES))
      return
    }
    const outcome = rand()
    if (outcome < 0.03) {
      state.status = 'skipped'
      return
    }
    const isco = chance(0.06) ? iscoSibling(r.isco) : r.isco
    const isic = chance(0.05) ? isicSibling(r.isic) : r.isic
    save(r, 'demo_t_isco', iscoPath(isco), actor, time, startedAt)
    labelled.ISCO08++
    if (outcome < 0.07) {
      state.status = 'pending' // ISIC still to do
      return
    }
    const isicTime = time + between(15, 90) * 1000
    save(r, 'demo_t_isic', isicPath(isic), actor, isicTime, null)
    labelled.ISIC4++
    state.editedAt = isicTime
    if (outcome < 0.085) {
      state.status = 'escalated'
      state.flagged = chance(0.5)
      thread(
        r,
        actor,
        'Escalating: the title and the tasks point to different unit groups.',
        isicTime,
        supervisor,
        'Taken to the methodology meeting on Thursday.'
      )
    } else if (chance(0.025)) {
      state.flagged = chance(0.4)
      thread(r, actor, pick(QUESTIONS)(r), isicTime, supervisor, pick(ANSWERS))
    }
    // Supervisors review a sample and correct most of the mistakes they find.
    if ((isco !== r.isco || isic !== r.isic) && chance(0.55)) {
      // Whole days later keeps the time of day within working hours; weekends move to Monday.
      let reviewed = time + Math.ceil(between(0, 5)) * DAY + between(1, 20) * MINUTE
      while ([0, 6].includes(new Date(reviewed).getUTCDay())) reviewed += DAY
      if (reviewed < now - MINUTE) {
        if (isco !== r.isco) save(r, 'demo_t_isco', iscoPath(r.isco), supervisor, reviewed, null)
        if (isic !== r.isic) save(r, 'demo_t_isic', isicPath(r.isic), supervisor, reviewed + 30_000, null)
        state.editor = supervisor
        state.editedAt = reviewed + 30_000
      }
    }
  }

  for (const l of LABELLERS) {
    const q12 = records.filter(r => r.batch === 0 && assignee.get(r) === l)
    const done = Math.round(q12.length * l.pace!)
    const times = spread(done, 43, l.leftDaysAgo ?? 0)
    q12.slice(0, done).forEach((r, j) => label(r, l, times[j]!))
    const q3 = records.filter(r => r.batch === 1 && assignee.get(r) === l)
    if (q3.length > 0) {
      const doneQ3 = Math.round(q3.length * between(0.2, 0.4))
      const timesQ3 = spread(doneQ3, 4, 0)
      q3.slice(0, doneQ3).forEach((r, j) => label(r, l, timesQ3[j]!))
    }
  }

  await tx.sentence.createMany({
    data: records.map(r => {
      const state = sentenceState.get(r)
      return {
        id: sentenceId(r),
        workspaceId: WORKSPACE_ID,
        recordKey: r.key,
        importId: importIds[r.batch]!,
        importOrder: r.order,
        field1: r.field1,
        field2: r.field2,
        field3: r.field3,
        support1: r.supports[0],
        support2: r.supports[1],
        support3: r.supports[2],
        support4: r.supports[3],
        support5: r.supports[4],
        fieldMapping: FIELD_MAPPING,
        supportMapping: SUPPORT_MAPPING,
        status: state?.status ?? 'pending',
        flagged: state?.flagged ?? false,
        lastEditorId: state?.editor ?? null,
        lastEditedAt: state?.editedAt ? new Date(state.editedAt) : null,
        createdAt: new Date(importedAt[r.batch]!)
      }
    })
  })
  for (const part of chunks(assignments)) await tx.sentenceAssignment.createMany({ data: part })
  const annotationRows = [...annotations.values()].flat()
  for (const part of chunks(annotationRows)) await tx.sentenceAnnotation.createMany({ data: part })
  for (const part of chunks(activity)) await tx.labelingActivity.createMany({ data: part })
  await tx.comment.createMany({ data: comments })

  // AI suggestions, as if a labelling run went over Q1-Q2 in its first week.
  const suggestedAt = new Date(daysAgo(41))
  const suggestions: Prisma.SentenceAISuggestionCreateManyInput[] = []
  const suggest = (r: DemoRecord, taxonomyId: string, path: string[], confidence: number) => {
    path.forEach((code, i) =>
      suggestions.push({
        workspaceId: WORKSPACE_ID,
        sentenceId: sentenceId(r),
        taxonomyId,
        level: i + 1,
        nodeCode: code,
        confidenceScore: Math.round(Math.min(0.99, confidence + (path.length - 1 - i) * 0.05) * 1000) / 1000,
        suggestedAt
      })
    )
  }
  for (const r of records) {
    if (r.batch !== 0 || !chance(0.75)) continue
    if (r.vague) {
      suggest(r, 'demo_t_isco', iscoPath(pick(iscoLeaves)), between(0.15, 0.4))
      suggest(r, 'demo_t_isic', isicPath(pick(isicLeaves)), between(0.15, 0.4))
      continue
    }
    const iscoRight = chance(0.8)
    suggest(
      r,
      'demo_t_isco',
      iscoPath(iscoRight ? r.isco : iscoSibling(r.isco)),
      iscoRight ? between(0.7, 0.96) : between(0.35, 0.65)
    )
    const isicRight = chance(0.85)
    suggest(
      r,
      'demo_t_isic',
      isicPath(isicRight ? r.isic : isicSibling(r.isic)),
      isicRight ? between(0.75, 0.97) : between(0.35, 0.65)
    )
  }
  for (const part of chunks(suggestions)) await tx.sentenceAISuggestion.createMany({ data: part })

  await tx.taxonomy.update({ where: { id: 'demo_t_isco' }, data: { newAnnotationsSinceLastLearning: labelled.ISCO08 } })
  await tx.taxonomy.update({ where: { id: 'demo_t_isic' }, data: { newAnnotationsSinceLastLearning: labelled.ISIC4 } })

  return {
    records: records.length,
    labelled: sentenceState.size,
    annotations: annotationRows.length,
    activity: activity.length,
    comments: comments.length,
    suggestions: suggestions.length,
    members: admins.length + PEOPLE.length
  }
}

// --- CSV export (for uploading the same data by hand) ----------------------

function csv(rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(cell).join(',')).join('\n') + '\n'
}

function writeCsv(dir: string) {
  mkdirSync(dir, { recursive: true })
  const taxonomyRows = (nodes: TaxNode[]) => [
    ['id', 'label', 'parent_id', 'level', 'definition'],
    ...nodes.map(n => [n.code, n.label, n.parentCode, n.level, n.definition])
  ]
  writeFileSync(join(dir, 'isco08.csv'), csv(taxonomyRows(iscoNodes)))
  writeFileSync(join(dir, 'isic4.csv'), csv(taxonomyRows(isicNodes)))
  const header = [
    'id',
    ...Object.values(FIELD_MAPPING).map(f => `field_${f}`),
    ...Object.values(SUPPORT_MAPPING).map(s => `support_${s}`)
  ]
  const records = buildRecords()
  for (const [batch, name] of ['lfs-2026-q1-q2.csv', 'lfs-2026-q3.csv'].entries()) {
    const rows = records.filter(r => r.batch === batch).map(r => [r.key, r.field1, r.field2, r.field3, ...r.supports])
    writeFileSync(join(dir, name), csv([header, ...rows]))
  }
  console.log(`✓ Wrote isco08.csv, isic4.csv, lfs-2026-q1-q2.csv and lfs-2026-q3.csv to ${dir}`)
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const csvAt = args.indexOf('--csv')
  if (csvAt >= 0) {
    const dir = args[csvAt + 1]
    if (!dir) throw new Error('--csv needs a directory')
    writeCsv(dir)
    return
  }

  const reset = args.includes('--reset') || process.env.DEMO_SEED?.toLowerCase() === 'reset'
  const password = process.env.DEMO_PASSWORD || ''
  if (password) {
    for (const p of PEOPLE) {
      const weak = passwordProblem(password, {
        username: username(p),
        email: `${username(p)}@example.com`,
        name: p.name
      })
      if (weak) throw new Error(`DEMO_PASSWORD is not acceptable for ${username(p)}: ${weak}`)
    }
  }

  const prisma = connect()
  try {
    const existing = await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID }, select: { id: true } })
    if (existing && !reset) {
      console.log(`✓ Demo workspace "${WORKSPACE_ID}" already exists; nothing to do (DEMO_SEED=reset rebuilds it)`)
      return
    }
    const passwordHash = password ? await hashPassword(password) : null
    const started = Date.now()
    const counts = await prisma.$transaction(
      async tx => {
        if (existing) await deleteWorkspace(tx)
        return seed(tx, passwordHash, reset)
      },
      { timeout: 600_000, maxWait: 30_000 }
    )
    console.log(
      `✓ Demo workspace "${WORKSPACE_ID}" ${existing ? 'rebuilt' : 'seeded'} in ${((Date.now() - started) / 1000).toFixed(1)} s:`,
      counts
    )
    if (!password)
      console.log(
        '  DEMO_PASSWORD is not set: the demo.* accounts cannot sign in (platform admins can open the workspace).'
      )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('✗ Demo seeding failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
