import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { ideas } from '../../../../db/schema'
import { addReferenceLink, referenceLinkBodySchema } from '../../../../services/reference-link-service'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, id) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }

  const parsed = referenceLinkBodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'URL inválida', data: parsed.error.flatten() })
  }

  const link = await addReferenceLink({ entityType: 'idea', entityId: id, addedBy: actor.id, ...parsed.data })
  return { link }
})
