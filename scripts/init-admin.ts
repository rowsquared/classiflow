// Creates the first admin account if the database has no admin yet.
// Runs on every container start (scripts/start.sh); `node scripts/init-admin.ts`.
//
// - Does nothing when any admin, or a user with the configured username/email,
//   already exists. It never changes an existing account: to recover access use
//   scripts/reset-admin-password.ts.
// - Needs DEFAULT_ADMIN_PASSWORD only when it actually creates the account, and
//   in production refuses well-known placeholder passwords. The password is
//   never logged.
// - Exits non-zero on failure, so a broken bootstrap stops startup instead of
//   leaving a server nobody can sign in to.
import { connect } from './lib/db.ts'
import { setPassword, USERNAME_PATTERN } from '../lib/passwords.ts'

const PLACEHOLDER_PASSWORDS = new Set([
  'change-me-immediately',
  'changeme123!',
  'changeme',
  'admin123',
  'password',
  'your-secure-password',
])

const prisma = connect()

async function initAdmin() {
  // Sign-in names and emails are stored in lower case (lib/auth.ts).
  const adminUsername = (process.env.DEFAULT_ADMIN_USERNAME || 'admin').toLowerCase()
  const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@classiflow.local').toLowerCase()
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || ''
  const adminName = process.env.DEFAULT_ADMIN_NAME || 'System Administrator'

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { role: 'admin' },
        { email: adminEmail },
        { username: adminUsername }
      ]
    },
    select: { id: true }
  })

  if (existing) {
    console.log('✓ Admin user already exists; nothing to do')
    return
  }

  if (!USERNAME_PATTERN.test(adminUsername)) {
    throw new Error('DEFAULT_ADMIN_USERNAME may only contain letters, digits, dot, underscore and hyphen')
  }
  if (adminPassword.length < 8) {
    throw new Error('No admin exists yet and DEFAULT_ADMIN_PASSWORD is missing or shorter than 8 characters')
  }
  if (PLACEHOLDER_PASSWORDS.has(adminPassword.toLowerCase())) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DEFAULT_ADMIN_PASSWORD is a well-known placeholder; set a real password')
    }
    console.warn('⚠ DEFAULT_ADMIN_PASSWORD is a well-known placeholder (allowed outside production)')
  }

  await prisma.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        username: adminUsername,
        displayUsername: adminUsername,
        email: adminEmail,
        name: adminName,
        role: 'admin',
        mustResetPassword: true
      }
    })
    await setPassword(tx, user.id, adminPassword)
  })

  console.log(`✓ Admin user "${adminUsername}" created with the password from DEFAULT_ADMIN_PASSWORD`)
  console.log('  It must be changed at first sign-in.')
}

initAdmin()
  .catch(error => {
    console.error('✗ Admin initialization failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
