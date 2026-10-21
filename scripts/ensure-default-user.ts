import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Check if any users exist
  const userCount = await prisma.user.count()
  
  if (userCount === 0) {
    console.log('No users found. Creating default user...')
    
    const user = await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@classiflow.local',
        name: 'Default Admin',
        password: await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'change-me-immediately', 10),
        role: 'admin',
        mustResetPassword: true
      }
    })
    
    console.log('Created default user:', user.email)
  } else {
    console.log(`Found ${userCount} user(s) in database`)
    const firstUser = await prisma.user.findFirst()
    console.log('First user:', firstUser?.email)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

