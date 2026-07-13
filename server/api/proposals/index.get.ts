import { desc, ne } from 'drizzle-orm'
import { db } from '../../db/client'
import { proposals } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

// Las canceladas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera (GET /api/admin/trash).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.proposals.findMany({ where: ne(proposals.status, 'cancelled'), orderBy: [desc(proposals.createdAt)] })
  return { proposals: rows }
})
