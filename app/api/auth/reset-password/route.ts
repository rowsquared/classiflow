import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSessionAllowingReset } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { checkPassword, revokeSessions, setPassword } from '@/lib/passwords'
import { z } from 'zod'
import { passwordProblem } from '@/lib/password-policy'

const resetPasswordSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().max(256)
})

export async function POST(req: NextRequest) {
  // The one business endpoint open to users who still have to change their password.
  const { session, user: currentUser, error } = await requireSessionAllowingReset()
  if (error) return error

  try {
    const body = await req.json()
    const { currentPassword, newPassword } = resetPasswordSchema.parse(body)

    if (!(await checkPassword(prisma, currentUser.id, currentPassword))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    const weak = passwordProblem(newPassword, session.user)
    if (weak) return NextResponse.json({ error: weak, field: 'newPassword' }, { status: 400 })
    // Otherwise the forced change could be satisfied with the handed-out password.
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'Choose a password different from the current one', field: 'newPassword' },
        { status: 400 }
      )
    }

    // New password, reset flag cleared, and every other session signed out;
    // this browser stays signed in.
    await prisma.$transaction(async tx => {
      await setPassword(tx, currentUser.id, newPassword)
      await tx.user.update({ where: { id: currentUser.id }, data: { mustResetPassword: false } })
      await revokeSessions(tx, currentUser.id, session.session.id)
    })

    await audit({
      actorId: currentUser.id,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: currentUser.id
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Password reset error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
