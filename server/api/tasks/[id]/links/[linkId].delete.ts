import { deleteReferenceLink } from '../../../../services/reference-link-service'
import { requireRole } from '../../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  const linkId = getRouterParam(event, 'linkId')
  if (!id || !linkId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea o de enlace' })
  }

  await deleteReferenceLink({ entityType: 'task', entityId: id, linkId, actorId: actor.id, actorRole: actor.role })
  return { success: true }
})
