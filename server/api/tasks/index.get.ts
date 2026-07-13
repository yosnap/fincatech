import { desc } from 'drizzle-orm'
import { db } from '../../db/client'
import { tasks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.tasks.findMany({ orderBy: [desc(tasks.createdAt)] })
  return { tasks: rows }
})
