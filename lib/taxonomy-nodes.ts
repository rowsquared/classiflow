import type { Prisma } from '@/lib/generated/prisma/client'
import type { TaxonomyCsvNode } from '@/lib/taxonomy-csv'

const BATCH_SIZE = 1000

/** Inserts parsed nodes and their synonyms (inside the caller's transaction). */
export async function createTaxonomyNodes(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taxonomyId: string,
  nodes: TaxonomyCsvNode[]
) {
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    await tx.taxonomyNode.createMany({
      data: nodes.slice(i, i + BATCH_SIZE).map(n => ({
        workspaceId,
        taxonomyId,
        code: n.code,
        label: n.label,
        level: n.level,
        parentCode: n.parentCode,
        definition: n.definition,
        examples: n.examples,
        path: n.path,
        isLeaf: n.isLeaf,
      })),
    })
  }

  const withSynonyms = nodes.filter(n => n.synonyms.length > 0)
  if (withSynonyms.length === 0) return

  // Synonyms link by node id, which only exists after the insert.
  const created = await tx.taxonomyNode.findMany({
    where: { taxonomyId, code: { in: withSynonyms.map(n => n.code) } },
    select: { id: true, code: true },
  })
  const idByCode = new Map(created.map(n => [n.code, n.id]))
  const synonyms = withSynonyms.flatMap(n => n.synonyms.map(synonym => ({
    workspaceId,
    taxonomyId,
    nodeId: idByCode.get(n.code)!,
    synonym,
  })))
  for (let i = 0; i < synonyms.length; i += BATCH_SIZE) {
    await tx.taxonomySynonym.createMany({ data: synonyms.slice(i, i + BATCH_SIZE) })
  }
}
