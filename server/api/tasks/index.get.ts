import { desc, isNull } from 'drizzle-orm'
import { db } from '../../db/client'
import { tasks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

// Las tareas descartadas quedan ocultas del listado normal — solo visibles en la papelera
// de Admin (GET /api/admin/trash).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.tasks.findMany({ where: isNull(tasks.discardedAt), orderBy: [desc(tasks.createdAt)] })
  return { tasks: rows }
})
