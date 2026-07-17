import { FONDO_COMUN_USER_ID } from '../../db/seed/fondo-comun'
import { auth } from '../../utils/auth'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const { users } = await auth.api.listUsers({
    query: { sortBy: 'name', sortDirection: 'asc' },
    headers: event.headers
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
    }))
  }
})
