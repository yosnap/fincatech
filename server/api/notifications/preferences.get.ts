import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { notificationPreferences } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const pref = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, actor.id)
  })
  return {
    telegramEnabled: pref?.telegramEnabled ?? false,
    emailEnabled: pref?.emailEnabled ?? true
  }
})
