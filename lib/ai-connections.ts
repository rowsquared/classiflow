import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { db, scopeWorkspaceId, withWorkspace } from '@/lib/workspace/db'
import { AI_SOURCE_SLUG, aiSourceSlug } from '@/lib/constants'
import {
  CredentialError,
  credentialAad,
  decryptCredential,
  deploymentKeyring,
  encryptCredential
} from '@/lib/ai-credentials'
import { taxomindClient, type TaxomindClient } from '@/lib/ai-labeling'
import { logger } from '@/lib/logger'

/**
 * Per-workspace AI connections (docs/plans/workspace-isolation.md, "Optional
 * AI").
 *
 * - Platform admins approve endpoints (AIEndpoint, control plane).
 * - A workspace admin creates a connection version: an approved endpoint plus
 *   the workspace's own credential, encrypted (lib/ai-credentials.ts). A new
 *   version retires the previous one. Versions never change; a retired
 *   version's credential is erased once no active job uses it.
 * - New jobs need `Workspace.aiEnabled`, an active version on an unretired
 *   endpoint, and a deployment that can decrypt (AI_CREDENTIALS_KEYS) and name
 *   namespaces (AI_SOURCE_SLUG). Jobs record their version and keep using it
 *   (polling, cancelling) whatever changes later.
 *
 * The deployment variable AI_LABELING_API_URL, if set, is only registered as
 * an approved endpoint (ensureEnvEndpoint); it configures no workspace.
 */

export type AIDeployment = {
  /** AI_CREDENTIALS_KEYS is set and valid. */
  keysConfigured: boolean
  /** AI_CREDENTIALS_KEYS is set but malformed (message without key material). */
  keysError: string | null
  sourceSlugConfigured: boolean
  /** Workspaces may configure and run AI. */
  ready: boolean
}

export function aiDeployment(): AIDeployment {
  let keysConfigured = false
  let keysError: string | null = null
  try {
    keysConfigured = deploymentKeyring() !== null
  } catch (error) {
    keysError = error instanceof Error ? error.message : 'invalid'
  }
  const sourceSlugConfigured = AI_SOURCE_SLUG !== ''
  return { keysConfigured, keysError, sourceSlugConfigured, ready: keysConfigured && sourceSlugConfigured }
}

function keyring() {
  const ring = deploymentKeyring()
  if (!ring) throw new CredentialError('AI_CREDENTIALS_KEYS is not set')
  return ring
}

// ---------------------------------------------------------------------------
// Approved endpoints (platform)
// ---------------------------------------------------------------------------

export class EndpointUrlError extends Error {
  name = 'EndpointUrlError'
}

/**
 * The canonical form of an endpoint base URL: http(s), no credentials, query
 * or fragment, no trailing slash. Taxomind may sit under a path prefix
 * (`https://host/api`).
 */
export function normalizeEndpointUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new EndpointUrlError('Not a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EndpointUrlError('Use an http(s) URL')
  if (url.username || url.password) throw new EndpointUrlError('The URL must not contain credentials')
  if (url.search || url.hash) throw new EndpointUrlError('The URL must not contain a query or fragment')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export type EndpointSummary = { id: string; name: string; baseUrl: string; createdAt: Date; retiredAt: Date | null }

const endpointSelect = { id: true, name: true, baseUrl: true, createdAt: true, retiredAt: true } as const

export async function listEndpoints({ includeRetired = false } = {}): Promise<EndpointSummary[]> {
  return prisma.aIEndpoint.findMany({
    where: includeRetired ? {} : { retiredAt: null },
    select: endpointSelect,
    orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }]
  })
}

/** Approves an endpoint, or approves a retired one again. */
export async function approveEndpoint(input: { name: string; baseUrl: string; actorId: string }) {
  const baseUrl = normalizeEndpointUrl(input.baseUrl)
  return prisma.aIEndpoint.upsert({
    where: { baseUrl },
    create: { name: input.name, baseUrl, createdById: input.actorId },
    update: { name: input.name, retiredAt: null },
    select: endpointSelect
  })
}

/** Retired endpoints take no new connections or jobs; running jobs finish. */
export async function retireEndpoint(id: string) {
  const result = await prisma.aIEndpoint.updateMany({ where: { id, retiredAt: null }, data: { retiredAt: new Date() } })
  return result.count === 1
}

/**
 * Registers AI_LABELING_API_URL (the pre-workspace setting) as an approved
 * endpoint, once. It configures no workspace: each still needs its own
 * connection and credential. An endpoint a platform admin retired stays
 * retired.
 */
export async function ensureEnvEndpoint(): Promise<void> {
  const raw = process.env.AI_LABELING_API_URL
  if (!raw) return
  let baseUrl: string
  try {
    baseUrl = normalizeEndpointUrl(raw)
  } catch (error) {
    logger.error({ err: error }, 'AI_LABELING_API_URL is not usable')
    return
  }
  await prisma.aIEndpoint.upsert({
    where: { baseUrl },
    create: { name: 'Deployment default (AI_LABELING_API_URL)', baseUrl },
    update: {}
  })
}

// ---------------------------------------------------------------------------
// Workspace connections (inside withWorkspace)
// ---------------------------------------------------------------------------

const versionSelect = {
  id: true,
  version: true,
  namespace: true,
  createdAt: true,
  retiredAt: true,
  credential: true,
  endpoint: { select: { id: true, name: true, baseUrl: true, retiredAt: true } }
} as const

type VersionRow = {
  id: string
  version: number
  namespace: string
  createdAt: Date
  retiredAt: Date | null
  credential: string | null
  endpoint: { id: string; name: string; baseUrl: string; retiredAt: Date | null }
}

/** What the API shows of a connection version: never the credential, only whether one is stored. */
export function connectionSummary(row: VersionRow) {
  return {
    id: row.id,
    version: row.version,
    namespace: row.namespace,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
    credentialStored: row.credential !== null,
    endpoint: { id: row.endpoint.id, name: row.endpoint.name, baseUrl: row.endpoint.baseUrl },
    endpointRetired: row.endpoint.retiredAt !== null
  }
}
export type ConnectionSummary = ReturnType<typeof connectionSummary>

async function activeVersion(): Promise<VersionRow | null> {
  return db().aIConnectionVersion.findFirst({
    where: { retiredAt: null },
    orderBy: { version: 'desc' },
    select: versionSelect
  })
}

/** The workspace's AI settings for its admins (no secrets). */
export async function workspaceAISettings() {
  const workspaceId = scopeWorkspaceId()
  const [workspace, active, versions] = await Promise.all([
    db().workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiEnabled: true } }),
    activeVersion(),
    db().aIConnectionVersion.findMany({ orderBy: { version: 'desc' }, take: 20, select: versionSelect })
  ])
  const deployment = aiDeployment()
  return {
    deployment: {
      ready: deployment.ready,
      keysConfigured: deployment.keysConfigured,
      sourceSlugConfigured: deployment.sourceSlugConfigured
    },
    enabled: workspace.aiEnabled,
    namespace: deployment.sourceSlugConfigured ? aiSourceSlug(workspaceId) : null,
    active: active ? connectionSummary(active) : null,
    versions: versions.map(connectionSummary),
    endpoints: (await listEndpoints()).map(e => ({ id: e.id, name: e.name, baseUrl: e.baseUrl }))
  }
}

/** Why the workspace cannot start AI jobs now, or null when it can. */
export type AIUnavailable =
  'deployment_not_configured' | 'disabled' | 'no_connection' | 'endpoint_retired' | 'credential_missing'

export const AI_UNAVAILABLE_MESSAGES: Record<AIUnavailable, string> = {
  deployment_not_configured: 'AI is not available on this deployment (AI_CREDENTIALS_KEYS and AI_SOURCE_SLUG).',
  disabled: 'AI is turned off for this workspace. An admin can turn it on under Admin › AI settings.',
  no_connection: 'This workspace has no AI connection. An admin can add one under Admin › AI settings.',
  endpoint_retired: "The AI service of this workspace's connection is no longer approved. Choose another one.",
  credential_missing: "The AI connection's credential is missing. Add the connection again."
}

/**
 * The connection version new jobs of the current workspace run with, or why
 * there is none. Call inside the transaction that creates the jobs.
 */
export async function connectionForNewJobs(): Promise<{ id: string } | { unavailable: AIUnavailable }> {
  if (!aiDeployment().ready) return { unavailable: 'deployment_not_configured' }
  const workspaceId = scopeWorkspaceId()
  const workspace = await db().workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace.aiEnabled) return { unavailable: 'disabled' }
  const active = await activeVersion()
  if (!active) return { unavailable: 'no_connection' }
  if (active.endpoint.retiredAt) return { unavailable: 'endpoint_retired' }
  if (!active.credential) return { unavailable: 'credential_missing' }
  return { id: active.id }
}

export class ConnectionInputError extends Error {
  name = 'ConnectionInputError'
}

/**
 * A new connection version for the current workspace (write transaction). The
 * previous version is retired; jobs that use it keep it until they finish.
 * The credential is encrypted before it reaches the database.
 */
export async function createConnectionVersion(input: { endpointId: string; credential: string; actorId: string }) {
  const workspaceId = scopeWorkspaceId()
  const deployment = aiDeployment()
  if (!deployment.ready) throw new ConnectionInputError(AI_UNAVAILABLE_MESSAGES.deployment_not_configured)
  const endpoint = await db().aIEndpoint.findUnique({ where: { id: input.endpointId }, select: { retiredAt: true } })
  if (!endpoint || endpoint.retiredAt) throw new ConnectionInputError('Choose an approved AI service')

  // One version number at a time per workspace.
  await db().$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classiflow:ai-connection:${workspaceId}`}))`
  const latest = await db().aIConnectionVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } })
  const now = new Date()
  await db().aIConnectionVersion.updateMany({ where: { retiredAt: null }, data: { retiredAt: now } })
  const id = randomUUID()
  const created = await db().aIConnectionVersion.create({
    data: {
      id,
      workspaceId,
      version: (latest?.version ?? 0) + 1,
      endpointId: input.endpointId,
      namespace: aiSourceSlug(workspaceId),
      credential: encryptCredential(input.credential, credentialAad(workspaceId, id), keyring()),
      createdById: input.actorId
    },
    select: versionSelect
  })
  await eraseUnusedRetiredCredentials()
  return connectionSummary(created)
}

/** Turns AI on or off for new jobs. Turning it on needs a usable connection. */
export async function setWorkspaceAIEnabled(enabled: boolean): Promise<AIUnavailable | null> {
  const workspaceId = scopeWorkspaceId()
  if (enabled) {
    if (!aiDeployment().ready) return 'deployment_not_configured'
    const active = await activeVersion()
    if (!active) return 'no_connection'
    if (active.endpoint.retiredAt) return 'endpoint_retired'
    if (!active.credential) return 'credential_missing'
  }
  await db().workspace.update({ where: { id: workspaceId }, data: { aiEnabled: enabled } })
  return null
}

/** Retires the active version (and so turns AI off) without adding a new one. */
export async function removeActiveConnection(): Promise<boolean> {
  const workspaceId = scopeWorkspaceId()
  const result = await db().aIConnectionVersion.updateMany({
    where: { retiredAt: null },
    data: { retiredAt: new Date() }
  })
  await db().workspace.update({ where: { id: workspaceId }, data: { aiEnabled: false } })
  await eraseUnusedRetiredCredentials()
  return result.count > 0
}

const ACTIVE_STATUS = { in: ['pending' as const, 'processing' as const] }

/** Erases the credentials of retired versions that no pending or running job uses. */
export async function eraseUnusedRetiredCredentials(): Promise<number> {
  const result = await db().aIConnectionVersion.updateMany({
    where: {
      retiredAt: { not: null },
      credential: { not: null },
      labelingJobs: { none: { status: ACTIVE_STATUS } },
      learningJobs: { none: { status: ACTIVE_STATUS } },
      syncJobs: { none: { status: ACTIVE_STATUS } }
    },
    data: { credential: null }
  })
  return result.count
}

/**
 * The Taxomind client for one connection version, for the job monitor and
 * cancellation. Opens its own short workspace transaction; the decrypted
 * credential stays in the returned client's memory.
 */
export async function connectionClient(
  workspaceId: string,
  connectionVersionId: string
): Promise<{ client: TaxomindClient; namespace: string }> {
  const row = await withWorkspace(workspaceId, () =>
    db().aIConnectionVersion.findUnique({
      where: { id: connectionVersionId },
      select: { id: true, namespace: true, credential: true, endpoint: { select: { baseUrl: true } } }
    })
  )
  if (!row) throw new Error('The AI connection of this job no longer exists')
  if (!row.credential) throw new Error("The AI connection's credential was erased")
  const credential = decryptCredential(row.credential, credentialAad(workspaceId, row.id), keyring())
  return { client: taxomindClient({ baseUrl: row.endpoint.baseUrl, credential }), namespace: row.namespace }
}
