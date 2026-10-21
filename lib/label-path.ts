import type { Prisma, PrismaClient } from '@/lib/generated/prisma/client'
import { getUnknownCodeForLevel, isUnknownNodeCode } from '@/lib/constants'

/**
 * Server-side rules for a human label path, shared by the single-record and
 * bulk annotation endpoints. The UI enforces the same rules; the server no
 * longer trusts it to.
 *
 * A valid path for one taxonomy:
 * - has levels 1..N exactly once each, N <= the taxonomy's depth (max 5);
 * - uses string codes (leading zeros matter);
 * - level 1 is a root node, every later node's parent is the previous code;
 * - ends in a leaf node, or in the level-specific unknown code (-9, -99, ...),
 *   which may only appear as the last entry.
 */

export type LabelInput = { level: number; nodeCode: string }

export type PathNode = {
  code: string
  level: number
  parentCode: string | null
  isLeaf: boolean
}

const MAX_LEVELS = 5

/** Pure check. `nodes` maps code -> node for every known code in `labels`. Returns an error message or null. */
export function checkLabelPath(labels: LabelInput[], nodes: Map<string, PathNode>, maxDepth: number): string | null {
  if (labels.length === 0) return 'No labels given'

  const depth = Math.min(maxDepth || MAX_LEVELS, MAX_LEVELS)
  const sorted = [...labels].sort((a, b) => a.level - b.level)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].level !== i + 1) {
      return 'Labels must cover levels 1..N exactly once each'
    }
  }
  if (sorted.length > depth) return `This taxonomy has at most ${depth} levels`

  for (let i = 0; i < sorted.length; i++) {
    const { level, nodeCode } = sorted[i]
    const isLast = i === sorted.length - 1

    if (isUnknownNodeCode(nodeCode)) {
      if (nodeCode !== getUnknownCodeForLevel(level)) {
        return `Unknown at level ${level} must use code ${getUnknownCodeForLevel(level)}`
      }
      if (!isLast) return 'Unknown must be the last label in the path'
      continue
    }

    const node = nodes.get(nodeCode)
    if (!node) return `Code ${nodeCode} does not exist in this taxonomy`
    if (node.level !== level) return `Code ${nodeCode} is at level ${node.level}, not ${level}`

    const expectedParent = i === 0 ? null : sorted[i - 1].nodeCode
    if ((node.parentCode || null) !== expectedParent) {
      return i === 0
        ? `Code ${nodeCode} is not a top-level code`
        : `Code ${nodeCode} is not a child of ${expectedParent}`
    }
    if (isLast && !node.isLeaf) {
      return `Code ${nodeCode} is not a leaf: choose a more specific code or mark the next level unknown`
    }
  }
  return null
}

type Db = PrismaClient | Prisma.TransactionClient

/** Loads the nodes a path refers to and checks it. */
export async function validateLabelPath(
  db: Db,
  taxonomy: { id: string; maxDepth: number },
  labels: LabelInput[]
): Promise<string | null> {
  const codes = Array.from(new Set(labels.map(l => l.nodeCode).filter(c => !isUnknownNodeCode(c))))
  const rows = codes.length === 0 ? [] : await db.taxonomyNode.findMany({
    where: { taxonomyId: taxonomy.id, code: { in: codes } },
    select: { code: true, level: true, parentCode: true, isLeaf: true },
  })

  const nodes = new Map<string, PathNode>(rows.map(r => [r.code, r]))
  return checkLabelPath(labels, nodes, taxonomy.maxDepth)
}

/** True when two label sets are the same path (order-insensitive). */
export function sameLabels(a: LabelInput[], b: LabelInput[]): boolean {
  if (a.length !== b.length) return false
  const key = (l: LabelInput) => `${l.level}:${l.nodeCode}`
  const set = new Set(a.map(key))
  return b.every(l => set.has(key(l)))
}
