import { promoteIdea } from '../../../services/proposal-service'
import { requireRole } from '../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const ideaId = getRouterParam(event, 'id')
  if (!ideaId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const proposal = await promoteIdea({ ideaId, actorId: actor.id, actorRole: actor.role })
  return { proposal }
})
