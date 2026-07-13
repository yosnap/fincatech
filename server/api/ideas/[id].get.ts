import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideaComments, ideas } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, id) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }

  const comments = await db.query.ideaComments.findMany({
    where: eq(ideaComments.ideaId, id),
    orderBy: (c, { asc }) => [asc(c.createdAt)]
  })

  return { idea, comments }
})
