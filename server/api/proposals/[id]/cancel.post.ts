import { cancelProposal } from '../../../services/proposal-service'
import { requireRole } from '../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const proposalId = getRouterParam(event, 'id')
  if (!proposalId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const proposal = await cancelProposal({ proposalId, actorId: actor.id, actorRole: actor.role })
  return { proposal }
})
