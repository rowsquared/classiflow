import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'

// Public readiness probe: reports whether the database answers and
// which commit is running (SOURCE_COMMIT, set at image build), so a deploy can
// be checked against the commit CI tested. The repository is public; nothing
// else about the deployment is exposed.
export async function GET() {
  const release = process.env.SOURCE_COMMIT || null
  try {
    const [database] = await prisma.$queryRaw<{ rowSecurity: boolean }[]>`
      SELECT row_security_active('"Sentence"'::regclass) AS "rowSecurity"`

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      rowSecurity: database?.rowSecurity ?? false,
      release
    })
  } catch (error) {
    await logError('Health check failed', error)
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
