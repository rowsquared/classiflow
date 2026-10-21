// Recovery: set a new temporary password for an existing admin account.
//
//   NEW_PASSWORD='…' node scripts/reset-admin-password.js <username-or-email>
//
// In the production container:
//   docker compose exec -e NEW_PASSWORD='…' app node scripts/reset-admin-password.js admin
//
// The account must change the password at next sign-in, and all of its existing
// sessions end. Only admin accounts can be reset this way (other users are reset
// by an admin in the Team page). The password is never logged.
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function resetAdminPassword() {
  const identifier = process.argv[2]
  const newPassword = process.env.NEW_PASSWORD || ''

  if (!identifier) {
    throw new Error('Usage: NEW_PASSWORD=… node scripts/reset-admin-password.js <username-or-email>')
  }
  if (newPassword.length < 8) {
    throw new Error('Set NEW_PASSWORD (at least 8 characters) in the environment')
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    select: { id: true, username: true, role: true }
  })
  if (!user) {
    throw new Error(`No user "${identifier}". To create the first admin, run scripts/init-admin.js`)
  }
  if (user.role !== 'admin') {
    throw new Error(`"${user.username}" is not an admin; reset it from the Team page instead`)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(newPassword, 10),
      mustResetPassword: true,
      sessionVersion: { increment: 1 }
    }
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
