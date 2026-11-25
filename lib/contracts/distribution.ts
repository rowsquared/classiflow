import { z } from 'zod'

export const MAX_DISTRIBUTION_LABELLERS = 100

export const distributionRequest = z.object({
  queue: z.string().max(10_000),
  labellerIds: z.array(z.string().min(1).max(200)).min(2).max(MAX_DISTRIBUTION_LABELLERS),
  mode: z.enum(['even', 'workload']),
  confirmation: z
    .object({
      seed: z.number().int().min(1).max(2_147_483_646),
      fingerprint: z.hash('sha256')
    })
    .optional()
})

export type DistributionRequest = z.infer<typeof distributionRequest>
export type DistributionLabeller = { id: string; name: string; email: string }

export type DistributionPreview = {
  matched: number
  eligible: number
  maxRecords: number
  people: Array<{ id: string; open: number; added: number }>
  confirmation: NonNullable<DistributionRequest['confirmation']> | null
}

export type DistributionResult = { assigned: number }
