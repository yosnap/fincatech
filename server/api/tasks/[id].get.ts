import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { media, tasks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea' })
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }

  const taskMedia = await db.query.media.findMany({ where: eq(media.taskId, id) })

  return {
    task,
    media: taskMedia.map(m => ({ id: m.id, type: m.type, createdAt: m.createdAt, uploadedBy: m.uploadedBy }))
  }
})
