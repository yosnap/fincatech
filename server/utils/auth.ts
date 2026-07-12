import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { db } from '../db/client'
import * as schema from '../db/schema'
import { getEnv } from './env'
import { ac, adminRole, guestRole, ownerRole } from './permissions'

const env = getEnv()

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications
    }
  }),
  emailAndPassword: {
    enabled: true,
    // Sin auto-registro público: los usuarios solo se crean vía /api/auth/accept-invite
    // (server/api/auth/accept-invite.post.ts), que llama a auth.api.createUser server-side.
    disableSignUp: true
  },
  plugins: [
    admin({
      defaultRole: 'guest',
      adminRoles: ['admin'],
      ac,
      roles: { admin: adminRole, owner: ownerRole, guest: guestRole }
    })
  ],
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  }
})

// Tipo inferido (incluye role/banned del plugin admin) — evita casts `as { role?: string }`
// repetidos en middleware y endpoints que leen session.user.
export type AuthUser = typeof auth.$Infer.Session.user
