import { isNull } from 'drizzle-orm'
import { db } from '../../db/client'
import { FONDO_COMUN_USER_ID } from '../../db/seed/fondo-comun'
import { auth } from '../../utils/auth'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const { users } = await auth.api.listUsers({
    query: { sortBy: 'name', sortDirection: 'asc' },
    headers: event.headers
  })

  // Invitaciones sin resolver: ni aceptadas (usedAt) ni canceladas (cancelledAt) — incluye
  // las ya caducadas a propósito, para que el Admin las vea y decida cancelarlas o reenviar,
  // en vez de que desaparezcan solas de la vista sin ningún rastro.
  const pendingInvitations = await db.query.invitations.findMany({
    where: (i, { and }) => and(isNull(i.usedAt), isNull(i.cancelledAt)),
    orderBy: (i, { desc }) => [desc(i.createdAt)]
  })

  return {
    // El usuario de sistema "Fondo Común" (Fase 3) no es un miembro gestionable.
    members: users.filter(u => u.id !== FONDO_COMUN_USER_ID).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? 'guest',
      banned: u.banned ?? false,
      pendingApproval: (u as { pendingApproval?: boolean }).pendingApproval ?? false,
      createdAt: u.createdAt
    })),
    invitations: pendingInvitations.map(i => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      expired: i.expiresAt < new Date(),
      createdAt: i.createdAt
    }))
  }
})
