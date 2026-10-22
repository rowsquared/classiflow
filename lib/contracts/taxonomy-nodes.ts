import { z } from 'zod'

export const taxonomyNodesQuery = z.object({
  parentCode: z.string().optional(),
  code: z.string().min(1).optional(),
  level: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().trim().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(2_147_483_647).default(0)
})

export type TaxonomyNodesQuery = z.infer<typeof taxonomyNodesQuery>
