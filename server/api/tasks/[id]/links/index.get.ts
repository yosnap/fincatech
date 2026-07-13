import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { tasks } from '../../../../db/schema'
import { listReferenceLinks } from '../../../../services/reference-link-service'
import { requireRole } from '../../../../utils/rbac'

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

  const links = await listReferenceLinks('task', id)
  return { links }
})
