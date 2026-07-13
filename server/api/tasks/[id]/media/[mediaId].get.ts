import { and, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { media } from '../../../../db/schema'
import { getSignedUrl } from '../../../../services/storage'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const taskId = getRouterParam(event, 'id')
  const mediaId = getRouterParam(event, 'mediaId')
  if (!taskId || !mediaId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea o foto' })
  }

  const item = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.taskId, taskId)) })
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Foto no encontrada' })
  }

  const url = await getSignedUrl(item.objectName)
  return { url }
})
