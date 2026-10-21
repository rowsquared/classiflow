import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { isLoginLocked, recordLoginFailure, recordLoginSuccess } from './login-throttle'

// bcrypt hash of a random string, compared against when the user does not exist.
const DUMMY_HASH = '$2b$10$ONF6yEaFcnNpUMHkOHQDwuE3uJJSbPMeS3pUGYV8D7h1wjvw71Ig6'

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        const identifier = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''

        // bcrypt only reads the first 72 bytes; longer inputs are just a cost to us.
        if (!identifier || !password || identifier.length > 254 || password.length > 256) {
          return null
        }

        if (isLoginLocked(identifier)) {
          console.warn('[AUTH] Login refused: too many failed attempts for this identifier')
          return null
        }

        // Try to find user by username or email
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: identifier },
              { email: identifier }
            ]
          }
        })

        // Compare against a dummy hash for unknown users so response time does
        // not reveal which usernames exist.
        const passwordMatch = await bcrypt.compare(password, user?.password || DUMMY_HASH)

        if (!user || !user.password || !passwordMatch) {
          recordLoginFailure(identifier)
          console.warn('[AUTH] Failed login attempt')
          return null
        }

        recordLoginSuccess(identifier)

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() }
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustResetPassword: user.mustResetPassword,
          sessionVersion: user.sessionVersion
        }
      }
    })
  ],
  pages: {
    signIn: '/login'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.mustResetPassword = user.mustResetPassword
        token.sessionVersion = user.sessionVersion ?? 0
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.mustResetPassword = token.mustResetPassword as boolean
        session.user.sessionVersion = Number(token.sessionVersion ?? 0)
      }
      return session
    }
  },
  session: {
    strategy: 'jwt'
  }
}

