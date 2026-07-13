import { asc } from 'drizzle-orm'
import { db } from '../../db/client'
import { reservations } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.reservations.findMany({ orderBy: [asc(reservations.startDate)] })
  return { reservations: rows }
})
