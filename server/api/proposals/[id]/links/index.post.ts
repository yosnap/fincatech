import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { proposals } from '../../../../db/schema'
import { addReferenceLink, referenceLinkBodySchema } from '../../../../services/reference-link-service'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) })
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }

  const parsed = referenceLinkBodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'URL inválida', data: parsed.error.flatten() })
  }

  const link = await addReferenceLink({ entityType: 'proposal', entityId: id, addedBy: actor.id, ...parsed.data })
  return { link }
})
