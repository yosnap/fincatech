import type { H3Event } from 'h3'
import { z } from 'zod'

export const ROLE_VALUES = ['admin', 'owner', 'guest'] as const
export const roleSchema = z.enum(ROLE_VALUES)
export type Role = (typeof ROLE_VALUES)[number]

export interface SessionUser {
  id: string
  role: string
  banned: boolean
}

declare module 'h3' {
  interface H3EventContext {
    user: SessionUser | null
  }
}

// Autorización a nivel de servidor (nunca confiar solo en el frontend).
export function requireRole(event: H3Event, roles: Role[]): SessionUser {
  const user = event.context.user as SessionUser | null
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  if (!roles.includes(user.role as Role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return user
}

// El Invitado nunca ve desglose de deuda individual, solo agregados (PRD §3).
export function canSeeIndividualDebt(user: SessionUser | null): boolean {
  return !!user && user.role !== 'guest'
}
