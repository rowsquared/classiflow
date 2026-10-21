import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireSession } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'

const flagSchema = z.object({
  flagged: z.boolean()
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sentenceId: string }> }
) {
  const { user, error } = await requireSession()
  if (error) return error

  try {
    const { sentenceId } = await params
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied

    const parsed = flagSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }
    const { flagged } = parsed.data

    await prisma.sentence.update({
      where: { id: sentenceId },
      data: { flagged }
    })

    return NextResponse.json({ success: true, flagged })
  } catch (error) {
    console.error('Flag update error:', error)
    return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 })
  }
}
