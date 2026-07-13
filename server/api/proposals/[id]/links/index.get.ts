import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { proposals } from '../../../../db/schema'
import { listReferenceLinks } from '../../../../services/reference-link-service'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) })
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }

  const links = await listReferenceLinks('proposal', id)
  return { links }
})
