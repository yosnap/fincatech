import { desc, ne } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideas } from '../../db/schema'
import { requireRole } from '../../utils/rbac'
import { getUserNameMap } from '../../utils/user-names'

// Las descartadas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera (GET /api/admin/trash).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.ideas.findMany({ where: ne(ideas.status, 'discarded'), orderBy: [desc(ideas.createdAt)] })
  const nameMap = await getUserNameMap(rows.map(i => i.authorId))
  return { ideas: rows.map(i => ({ ...i, authorName: nameMap.get(i.authorId) ?? i.authorId })) }
})
