// Recovery: set a new temporary password for an existing admin account.
//
//   NEW_PASSWORD='…' node scripts/reset-admin-password.ts <username-or-email>
//
// In the production container:
//   docker compose exec -e NEW_PASSWORD='…' app node scripts/reset-admin-password.ts admin
//
// The account must change the password at next sign-in, and all of its existing
// sessions end. Only admin accounts can be reset this way (other users are reset
// by an admin in the Team page). The password is never logged.
import { connect } from './lib/db.ts'
import { revokeSessions, setPassword } from '../lib/passwords.ts'

const prisma = connect()

async function resetAdminPassword() {
  const identifier = (process.argv[2] || '').toLowerCase()
  const newPassword = process.env.NEW_PASSWORD || ''

  if (!identifier) {
    throw new Error('Usage: NEW_PASSWORD=… node scripts/reset-admin-password.ts <username-or-email>')
  }
  if (newPassword.length < 8) {
    throw new Error('Set NEW_PASSWORD (at least 8 characters) in the environment')
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    select: { id: true, username: true, role: true }
  })
  if (!user) {
    throw new Error(`No user "${identifier}". To create the first admin, run scripts/init-admin.ts`)
  }
  if (user.role !== 'admin') {
    throw new Error(`"${user.username}" is not an admin; reset it from the Team page instead`)
  }

  await prisma.$transaction(async tx => {
    await setPassword(tx, user.id, newPassword)
    await revokeSessions(tx, user.id)
    // A ban would keep the admin out even with the new password.
    await tx.user.update({
      where: { id: user.id },
      data: { mustResetPassword: true, banned: false, banReason: null, banExpires: null }
    })
  })

  console.log(`✓ Password for admin "${user.username}" reset. It must be changed at next sign-in;`)
  console.log('  existing sessions for this account have been signed out.')
}

resetAdminPassword()
  .catch(error => {
    console.error('✗', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
