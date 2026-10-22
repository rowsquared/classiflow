import { commentSummaries } from '@/lib/server/comment-summaries'
import { NextResponse } from 'next/server'
import { db } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'
import { logError } from '@/lib/logger'

const MAX_COMMENT_LENGTH = 10_000

// Comment access follows record access: anyone who can see the record can read,
// add and resolve its comments. Only the author or an admin may delete one.

export const POST = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied

    const { body } = await req.json()

    if (typeof body !== 'string' || body.trim() === '') {
      return NextResponse.json({ ok: false, error: 'Comment body is required' }, { status: 400 })
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `Comment is longer than ${MAX_COMMENT_LENGTH} characters` },
        { status: 400 }
      )
    }

    // Create the comment
    const comment = await db().comment.create({
      data: {
        workspaceId: user.workspaceId,
        body: body.trim(),
        sentenceId,
        authorId: user.id
      },
      include: {
        author: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    return NextResponse.json({ ok: true, comment })
  } catch (error) {
    await logError('Failed to create comment', error)
    return NextResponse.json({ ok: false, error: 'Failed to create comment' }, { status: 500 })
  }
})

export const GET = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied
    const { searchParams } = new URL(req.url)
    const includeResolved = searchParams.get('includeResolved') === 'true'

    const [comments, summaries] = await Promise.all([
      db().comment.findMany({
        where: {
          sentenceId,
          ...(includeResolved ? {} : { resolved: false })
        },
        include: {
          author: {
            select: {
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      commentSummaries([sentenceId])
    ])

    const commentSummary = summaries.get(sentenceId) ?? { total: 0, unresolved: 0 }
    return NextResponse.json({
      ok: true,
      comments,
      commentSummary,
      hasResolved: commentSummary.total > commentSummary.unresolved
    })
  } catch (error) {
    await logError('Failed to fetch comments', error)
    return NextResponse.json({ ok: false, error: 'Failed to fetch comments' }, { status: 500 })
  }
})

export const PATCH = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied
    const { commentId, resolved } = await req.json()

    if (!commentId || typeof resolved !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'commentId and resolved flag are required' }, { status: 400 })
    }

    const comment = await db().comment.findUnique({
      where: { id: commentId },
      select: { sentenceId: true }
    })

    if (!comment || comment.sentenceId !== sentenceId) {
      return NextResponse.json({ ok: false, error: 'Comment not found for this sentence' }, { status: 404 })
    }

    const updated = await db().comment.update({
      where: { id: commentId },
      data: {
        resolved,
        resolvedAt: resolved ? new Date() : null
      },
      include: {
        author: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    return NextResponse.json({ ok: true, comment: updated })
  } catch (error) {
    await logError('Failed to update comment', error)
    return NextResponse.json({ ok: false, error: 'Failed to update comment' }, { status: 500 })
  }
})

export const DELETE = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied

    const { commentId } = await req.json()

    if (!commentId) {
      return NextResponse.json({ ok: false, error: 'commentId is required' }, { status: 400 })
    }

    const comment = await db().comment.findUnique({
      where: { id: commentId },
      select: { sentenceId: true, authorId: true }
    })

    if (!comment || comment.sentenceId !== sentenceId) {
      return NextResponse.json({ ok: false, error: 'Comment not found for this sentence' }, { status: 404 })
    }

    if (comment.authorId !== user.id && user.role !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'Only the author or an admin can delete a comment' },
        { status: 403 }
      )
    }

    await db().comment.delete({
      where: { id: commentId }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    await logError('Failed to delete comment', error)
    return NextResponse.json({ ok: false, error: 'Failed to delete comment' }, { status: 500 })
  }
})
