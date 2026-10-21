import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Public liveness/readiness probe: reports whether the database answers and
// which commit is running (SOURCE_COMMIT, set at image build), so a deploy can
// be checked against the commit CI tested. The repository is public; nothing
// else about the deployment is exposed.
export async function GET() {
  const release = process.env.SOURCE_COMMIT || null
  try {
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      release
    })
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        release
      },
      { status: 503 }
    )
  }
}
