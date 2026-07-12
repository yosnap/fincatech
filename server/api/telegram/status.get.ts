import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { telegramLinks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const link = await db.query.telegramLinks.findFirst({ where: eq(telegramLinks.userId, actor.id) })
  return { linked: !!link }
})
