import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { prisma } from './prisma'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Allow localhost/preview hosts when explicitly trusted via env or in non-prod
  trustHost: process.env.AUTH_TRUST_HOST === 'true' || process.env.NODE_ENV !== 'production',
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.mustResetPassword = user.mustResetPassword
        token.sessionVersion = user.sessionVersion ?? 0
      }
      
      // Handle session update trigger - fetch fresh data from DB.
      // sessionVersion is deliberately not refreshed here: a revoked session must
      // not be able to revive itself by asking for an update.
      if (trigger === 'update' && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { mustResetPassword: true, role: true, name: true, email: true }
        })
        
        if (dbUser) {
          token.mustResetPassword = dbUser.mustResetPassword
          token.role = dbUser.role
          token.name = dbUser.name
          token.email = dbUser.email
        }
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
  }
})
