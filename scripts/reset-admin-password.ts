import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'

async function resetAdminPassword() {
  try {
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@classiflow.local'
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'

    console.log(`Looking for admin user with email: ${adminEmail}`)

    // Find admin user
    const admin = await prisma.user.findUnique({
      where: { email: adminEmail }
    })

    if (!admin) {
      console.log(`❌ Admin user with email ${adminEmail} not found!`)
      console.log('Creating new admin user...')
      
      const hashedPassword = await bcrypt.hash(adminPassword, 10)
      
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: process.env.DEFAULT_ADMIN_NAME || 'System Administrator',
          password: hashedPassword,
          role: 'admin',
          mustResetPassword: true
        }
      })
      
      console.log('✓ Admin user created successfully')
      console.log(`  Email: ${adminEmail}`)
      console.log(`  Password: ${adminPassword}`)
      return
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(adminPassword, 10)

    // Update admin user password
    await prisma.user.update({
      where: { email: adminEmail },
      data: {
        password: hashedPassword,
        mustResetPassword: true
      }
    })

    console.log('✓ Admin password reset successfully')
    console.log(`  Email: ${adminEmail}`)
    console.log(`  New Password: ${adminPassword}`)
    console.log(`  Password will need to be changed on first login`)
  } catch (error) {
    console.error('Error resetting admin password:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

resetAdminPassword()

