import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import { getVisibleUserIds } from '@/lib/access'
import { Prisma } from '@prisma/client'

/**
 * GET /api/progress/timeline?startDate=...&endDate=...&granularity=day
 * 
 * Returns daily/weekly breakdown of activity for charts
 */
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireSession()
    if (authError) return authError

    const searchParams = req.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const granularity = searchParams.get('granularity') || 'day' // 'day' or 'week'

    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'startDate and endDate are required' 
      }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'startDate and endDate must be valid dates' }, { status: 400 })
    }

    // Users whose work is visible: [] for admins (everyone), else self (+ team)
    const visibleUserIds = (await getVisibleUserIds(user)) ?? []

    // Build where clause for sentence visibility
    const sentenceWhere: Prisma.SentenceWhereInput = {}
    // For non-admins, filter by assignments
    // Note: For supervisors, visibleUserIds includes both their own ID and supervised users
    if (user.role !== 'admin') {
      if (visibleUserIds.length > 0) {
        sentenceWhere.assignments = {
          some: {
            userId: { in: visibleUserIds }
          }
        }
      } else {
        // If no visible user IDs, return no results
        sentenceWhere.id = 'impossible-id-no-results'
      }
    }

    // Get all sentences in the date range using Prisma
    const sentences = await prisma.sentence.findMany({
      where: {
        lastEditedAt: {
          gte: start,
          lte: end,
          not: null
        },
        ...(user.role !== 'admin' && visibleUserIds.length > 0 ? {
          assignments: {
            some: {
              userId: { in: visibleUserIds }
            }
          }
        } : {})
      },
      select: {
        lastEditedAt: true,
        status: true,
        flagged: true
      }
    })

    // Generate all dates in the period (to fill gaps)
    const allDates: string[] = []
    const currentDate = new Date(start)
    while (currentDate <= end) {
      allDates.push(currentDate.toISOString().split('T')[0])
      
      if (granularity === 'week') {
        currentDate.setDate(currentDate.getDate() + 7)
      } else {
        currentDate.setDate(currentDate.getDate() + 1)
      }
    }

    // Build timeline data array by grouping sentences by date
    const timeline = allDates.map(dateStr => {
      const sentencesOnDate = sentences.filter(s => {
        if (!s.lastEditedAt) return false
        const sentenceDate = s.lastEditedAt.toISOString().split('T')[0]
        return sentenceDate === dateStr
      })

      return {
        date: dateStr,
        completed: sentencesOnDate.filter(s => s.status === 'submitted').length,
        skipped: sentencesOnDate.filter(s => s.status === 'skipped').length,
        flagged: sentencesOnDate.filter(s => s.flagged === true).length
      }
    })

    return NextResponse.json({
      ok: true,
      granularity,
      timeline
    })

  } catch (error) {
    console.error('Progress timeline error:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ 
      error: errorMessage,
      details: error instanceof Error ? error.stack : String(error)
    }, { status: 500 })
  }
}

