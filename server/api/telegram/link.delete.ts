import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { telegramLinks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

// Desvincula el chat de Telegram del usuario actual (el bot deja de reconocerlo).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  await db.delete(telegramLinks).where(eq(telegramLinks.userId, actor.id))
  return { ok: true }
})
