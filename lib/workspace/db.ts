import { AsyncLocalStorage } from 'node:async_hooks'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma/client'

/**
 * Workspace-scoped database access.
 *
 * Workspace data (records, taxonomies, labels, comments, jobs, audit entries)
 * is read and written only inside withWorkspace(), which opens a transaction,
 * sets the transaction-local `app.workspace_id` that the row-security policies
 * check (prisma/migrations), and makes that transaction available as db().
 * Outside withWorkspace() db() throws, and the database itself shows no
 * workspace rows to the runtime role: access fails closed.
 *
 * Control-plane tables (User, Workspace, WorkspaceMembership, Better Auth's
 * tables) have no row security and may be read with the plain client too.
 */

export type WorkspaceDb = Prisma.TransactionClient

type Scope = { workspaceId: string; tx: WorkspaceDb; afterCommit: Array<() => void> }

const scope = new AsyncLocalStorage<Scope>()

/** Models whose rows belong to one workspace (they carry workspaceId). */
const WORKSPACE_MODELS = new Set([
  'Taxonomy', 'TaxonomySetting', 'TaxonomyNode', 'TaxonomySynonym', 'SentenceImport', 'SentenceAssignment',
  'Sentence', 'SentenceAnnotation', 'SentenceAISuggestion', 'AILabelingJob', 'AILearningJob', 'Comment',
  'WorkspaceMembership', 'AuditLog',
])
const FILTERED = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
])

type Args = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> }

const withOwner = (row: unknown, workspaceId: string) =>
  row && typeof row === 'object' && (row as { workspaceId?: unknown }).workspaceId === undefined
    ? { ...row, workspaceId }
    : row

/**
 * The second of three layers (with composite foreign keys and row security):
 * inside a workspace transaction every query on a workspace model is limited
 * to that workspace, and new rows are stamped with it. Development and test
 * databases often connect as a superuser, which row security does not bind;
 * this keeps their behaviour identical to production's.
 */
const scopedClient = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const current = scope.getStore()
        if (!current || !WORKSPACE_MODELS.has(model)) return query(args)
        const { workspaceId } = current
        const a = { ...(args as Args) }
        if (FILTERED.has(operation)) a.where = { ...a.where, workspaceId }
        if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
          a.data = Array.isArray(a.data) ? a.data.map(row => withOwner(row, workspaceId)) : withOwner(a.data, workspaceId)
        }
        if (operation === 'upsert') a.create = withOwner(a.create, workspaceId) as Record<string, unknown>
        return query(a as typeof args)
      },
    },
  },
})

/** Raised when a write reaches a workspace that is archived (or gone). */
export class WorkspaceArchivedError extends Error {
  constructor() {
    super('This workspace is archived and read-only')
  }
}

export type WorkspaceTransactionOptions = {
  /**
   * Writes take a shared lock on the workspace row and require it to be
   * active, so archiving (which takes an exclusive lock) waits for writes in
   * flight and no write starts on an archived workspace.
   */
  write?: boolean
  /** Interactive transaction timeout; imports and AI result writes need longer. */
  timeoutMs?: number
}

export async function withWorkspace<T>(
  workspaceId: string,
  fn: () => Promise<T>,
  { write = false, timeoutMs = 60_000 }: WorkspaceTransactionOptions = {}
): Promise<T> {
  const current = scope.getStore()
  if (current) {
    if (current.workspaceId !== workspaceId) {
      throw new Error('A workspace transaction cannot open another workspace')
    }
    return fn()
  }
  const afterCommit: Array<() => void> = []
  const result = await scopedClient.$transaction(async extendedTx => {
    const tx = extendedTx as unknown as WorkspaceDb
    await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`
    if (write) {
      const active = await tx.$queryRaw<unknown[]>`
        SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} AND status = 'active' FOR SHARE`
      if (active.length === 0) throw new WorkspaceArchivedError()
    }
    return scope.run({ workspaceId, tx, afterCommit }, fn)
  }, { timeout: timeoutMs, maxWait: 15_000 })
  for (const callback of afterCommit) callback()
  return result
}

/**
 * Runs `callback` once the current workspace transaction has committed (not
 * at all if it rolls back), e.g. to start a background job whose row it created.
 */
export function afterCommit(callback: () => void): void {
  const current = scope.getStore()
  if (!current) throw new Error('afterCommit() outside withWorkspace()')
  current.afterCommit.push(callback)
}

/** The current workspace transaction. Throws outside withWorkspace(). */
export function db(): WorkspaceDb {
  const current = scope.getStore()
  if (!current) throw new Error('Workspace data accessed outside withWorkspace()')
  return current.tx
}

/** The workspace of the current transaction, or null outside one. */
export function currentWorkspaceId(): string | null {
  return scope.getStore()?.workspaceId ?? null
}

/**
 * Runs `fn` inside the current workspace transaction. Code that used to open
 * its own transaction runs this way inside a workspaceRoute(), whose request
 * already is one transaction. Throws outside withWorkspace().
 */
export async function inCurrentWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  db()
  return fn()
}

/** The workspace of the current transaction. Throws outside withWorkspace(). */
export function scopeWorkspaceId(): string {
  const current = scope.getStore()
  if (!current) throw new Error('Workspace data accessed outside withWorkspace()')
  return current.workspaceId
}
