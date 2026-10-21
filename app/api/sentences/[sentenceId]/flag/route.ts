import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireSession } from '@/lib/api-auth'

const flagSchema = z.object({
  flagged: z.boolean()
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sentenceId: string }> }
) {
  const { error } = await requireSession()
  if (error) return error

  try {
    const { sentenceId } = await params
    const body = await req.json()
    const { flagged } = flagSchema.parse(body)

    await prisma.sentence.update({
      where: { id: sentenceId },
      data: { flagged }
    })

    return NextResponse.json({ success: true, flagged })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
