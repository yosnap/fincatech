import { desc } from 'drizzle-orm'
import { db } from '../../db/client'
import { proposals } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const rows = await db.query.proposals.findMany({ orderBy: [desc(proposals.createdAt)] })
  return { proposals: rows }
})
