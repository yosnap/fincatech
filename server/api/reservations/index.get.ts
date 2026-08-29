import { asc } from 'drizzle-orm'
import { db } from '../../db/client'
import { reservations } from '../../db/schema'
import { requireRole } from '../../utils/rbac'
import { getUserNameMap } from '../../utils/user-names'

// ownerName ya resuelto server-side (mismo patrón que ideas/propuestas): la vista de
// calendario y la leyenda de personas lo necesitan, y el calendario también lo ven
// Invitados, que no tienen acceso a endpoints de miembros.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.reservations.findMany({ orderBy: [asc(reservations.startDate)] })
  const nameMap = await getUserNameMap(rows.map(r => r.ownerId))
  return {
    reservations: rows.map(r => ({ ...r, ownerName: nameMap.get(r.ownerId) ?? r.ownerId }))
  }
})
