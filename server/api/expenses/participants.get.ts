import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

// Lista ligera de co-propietarios activos (admin/owner) para el selector de participantes
// al crear un gasto. Distinto de GET /api/members (Fase 2), que es solo-Admin y expone
// gestión completa de miembros; este endpoint también lo puede usar un owner.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner'])

  const rows = await db.select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.banned, false), inArray(users.role, ['admin', 'owner'])))

  return { members: rows }
})
