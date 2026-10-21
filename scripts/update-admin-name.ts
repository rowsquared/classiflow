import { prisma } from '../lib/prisma'

async function updateAdminName() {
  try {
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@classiflow.local'
    
    const updatedUser = await prisma.user.update({
      where: { email: adminEmail },
      data: { name: 'Admin' }
    })

    console.log('✓ Admin name updated successfully')
    console.log(`  Email: ${updatedUser.email}`)
    console.log(`  New name: ${updatedUser.name}`)
  } catch (error) {
    console.error('Error updating admin name:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

updateAdminName()

