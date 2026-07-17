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
    },
    // Detrás del proxy de Easypanel (Traefik) la IP real del cliente viaja en
    // X-Forwarded-For — sin esto, el rate-limiting cae a un único bucket compartido
    // para todos los usuarios en vez de limitar por IP real. `trustedProxies` es
    // obligatorio junto a esto: sin él, un cliente podría falsificar su propia IP en ese
    // header para eludir el rate-limiting (spoofing). Solo se confía en el valor del
    // header cuando la conexión llega desde una IP privada — el contenedor nunca recibe
    // tráfico directo de internet, todo pasa primero por el proxy interno de Easypanel,
    // así que cualquier conexión desde fuera de estos rangos no puede ser el proxy real.
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1']
    }
  }
})

// Tipo inferido (incluye role/banned del plugin admin) — evita casts `as { role?: string }`
// repetidos en middleware y endpoints que leen session.user.
export type AuthUser = typeof auth.$Infer.Session.user
