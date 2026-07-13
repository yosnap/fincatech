import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client'
import { media } from '../../db/schema'
import { getSignedUrl } from '../../services/storage'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de foto' })
  }

  const item = await db.query.media.findFirst({ where: and(eq(media.id, id), isNull(media.taskId)) })
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Foto no encontrada' })
  }

  const url = await getSignedUrl(item.objectName)
  return { url }
})
