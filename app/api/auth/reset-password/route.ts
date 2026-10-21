import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSessionAllowingReset } from '@/lib/api-auth'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const resetPasswordSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().min(8).max(256)
})

export async function POST(req: NextRequest) {
  // The one business endpoint open to users who still have to change their password.
  const { user: currentUser, error } = await requireSessionAllowingReset()
  if (error) return error

  try {
    const body = await req.json()
    const { currentPassword, newPassword } = resetPasswordSchema.parse(body)

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id }
    })

    if (!user || !user.password) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password)
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update password and reset flag. Bumping sessionVersion signs out every other
    // session; the reset page signs this browser back in with the new password.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustResetPassword: false,
        sessionVersion: { increment: 1 }
      }
    })

    // Return success with user email for re-authentication
    return NextResponse.json({ ok: true, email: user.email })
  } catch (error) {
    console.error('Password reset error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

