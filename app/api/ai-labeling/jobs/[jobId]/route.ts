import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { CaughtError } from '@/lib/utils'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { jobId } = await params
    const job = await prisma.aILabelingJob.findUnique({
      where: { id: jobId },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, job })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to fetch AI labeling job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch job' }, { status: 500 })
  }
}

