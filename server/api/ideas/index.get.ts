import { desc } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideas } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.ideas.findMany({ orderBy: [desc(ideas.createdAt)] })
  return { ideas: rows }
})
