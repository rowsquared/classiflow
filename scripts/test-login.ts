import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'

async function testLogin() {
  try {
    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@classiflow.local'
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!'

    console.log(`Testing login for: ${email}`)
    console.log(`Testing password: ${password}`)

    const user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user) {
      console.log('❌ User not found!')
      return
    }

    console.log(`✓ User found: ${user.name} (${user.email})`)
    console.log(`  Role: ${user.role}`)
    console.log(`  Must reset password: ${user.mustResetPassword}`)

    if (!user.password) {
      console.log('❌ User has no password!')
      return
    }

    console.log(`\nTesting password match...`)
    const passwordMatch = await bcrypt.compare(password, user.password)

    if (passwordMatch) {
      console.log('✅ PASSWORD MATCHES! Login should work.')
    } else {
      console.log('❌ PASSWORD DOES NOT MATCH!')
      console.log('\nDEBUG INFO:')
      console.log(`  Stored hash length: ${user.password.length}`)
      console.log(`  Password being tested: "${password}"`)
    }
  } catch (error) {
    console.error('Error testing login:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testLogin()

