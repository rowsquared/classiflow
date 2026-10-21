import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      mustResetPassword: boolean
      sessionVersion?: number
    } & DefaultSession['user']
  }

  interface User {
    id: string
    role: string
    mustResetPassword: boolean
    sessionVersion?: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: string
    mustResetPassword: boolean
    sessionVersion?: number
  }
}

