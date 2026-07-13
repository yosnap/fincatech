import { and, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { media } from '../../../../db/schema'
import { getSignedUrl } from '../../../../services/storage'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const ideaId = getRouterParam(event, 'id')
  const mediaId = getRouterParam(event, 'mediaId')
  if (!ideaId || !mediaId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea o foto' })
  }

  const item = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.ideaId, ideaId)) })
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Foto no encontrada' })
  }

  const url = await getSignedUrl(item.objectName)
  return { url }
})
