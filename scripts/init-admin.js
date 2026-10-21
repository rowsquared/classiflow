// Simple Node.js script to ensure admin user exists
// Can be run directly with node (no TypeScript compilation needed)
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

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
      await prisma.$disconnect()
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
    // Don't throw - allow app to start even if admin creation fails
    // (might fail if admin already exists with different credentials)
  } finally {
    await prisma.$disconnect()
  }
}

initAdmin()

