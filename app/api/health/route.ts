import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Public liveness/readiness probe: reports only whether the database answers.
export async function GET() {
	try {
		await prisma.$queryRaw`SELECT 1`

		return NextResponse.json({
			status: 'healthy',
			timestamp: new Date().toISOString(),
			database: 'connected',
		})
	} catch (error) {
		console.error('Health check failed:', error)
		return NextResponse.json(
			{
				status: 'unhealthy',
				timestamp: new Date().toISOString(),
				database: 'disconnected',
			},
			{ status: 503 }
		)
	}
}
