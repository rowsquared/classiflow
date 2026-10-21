import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'

async function initAdmin() {
  try {
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin'
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@classiflow.local'
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'change-me-immediately'
    const adminName = process.env.DEFAULT_ADMIN_NAME || 'System Administrator'

    // Check if admin user already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        OR: [
          { email: adminEmail },
          { username: adminUsername }
        ]
      }
    })

    if (existingAdmin) {
      console.log('✓ Admin user already exists')
      return
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 10)

    // Create admin user
    await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        name: adminName,
        password: hashedPassword,
        role: 'admin',
        mustResetPassword: true
      }
    })

    console.log('✓ Default admin user created successfully')
    console.log(`  Username: ${adminUsername}`)
    console.log(`  Email: ${adminEmail}`)
    console.log(`  Password: ${adminPassword}`)
    console.log('  ⚠️  Please change the password immediately after first login!')
  } catch (error) {
    console.error('Error initializing admin user:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

initAdmin()

