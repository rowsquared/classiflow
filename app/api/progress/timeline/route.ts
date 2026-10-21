import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * GET /api/progress/timeline?startDate=...&endDate=...&granularity=day
 * 
 * Returns daily/weekly breakdown of activity for charts
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // Determine which sentences the user can see based on role
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true }
    })

    let visibleUserIds: string[] = []

    if (user?.role === 'admin') {
      // Admins see all sentences
      visibleUserIds = []
    } else if (user?.role === 'supervisor') {
      // Get all labellers supervised by this user (including nested supervision)
      const getSupervisedUserIds = async (supervisorId: string): Promise<string[]> => {
        const labellers = await prisma.user.findMany({
          where: { supervisorId },
          select: { id: true, role: true }
        })
        
        let allIds = labellers.map(l => l.id)
        
        // Recursively get supervised users for any supervisors
        for (const labeller of labellers) {
          if (labeller.role === 'supervisor') {
            const nested = await getSupervisedUserIds(labeller.id)
            allIds = allIds.concat(nested)
          }
        }
        
        return allIds
      }
      
      visibleUserIds = await getSupervisedUserIds(session.user.id)
      visibleUserIds.push(session.user.id) // Include supervisor's own work
    } else {
      // Labellers see only their own sentences
      visibleUserIds = [session.user.id]
    }

    // Build where clause for sentence visibility
    const sentenceWhere: Prisma.SentenceWhereInput = {}
    // For non-admins, filter by assignments
    // Note: For supervisors, visibleUserIds includes both their own ID and supervised users
    if (user?.role !== 'admin') {
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
        ...(user?.role !== 'admin' && visibleUserIds.length > 0 ? {
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

