import { z } from 'zod'

export const queueAIRequest = z.object({
  queue: z.string().max(10_000),
  taxonomyKeys: z.array(z.string().min(1)).min(1).max(3),
  skipExisting: z.boolean(),
  confirmation: z.object({ id: z.uuid(), fingerprint: z.hash('sha256') }).optional()
})

export type QueueAIRequest = z.infer<typeof queueAIRequest>
export type QueueAITaxonomy = { key: string; ready: boolean }

export type QueueAIPreview = {
  matched: number
  protected: number
  taxonomies: Array<{
    key: string
    eligible: number
    alreadyQueued: number
    existing: number
    jobs: number
    limit: number
  }>
  confirmation: NonNullable<QueueAIRequest['confirmation']> | null
}

export const queueAIResult = z.object({
  jobs: z.number().int().positive(),
  taxonomies: z.array(
    z.object({ key: z.string(), records: z.number().int().nonnegative(), jobs: z.number().int().nonnegative() })
  )
})

export type QueueAIResult = z.infer<typeof queueAIResult>
