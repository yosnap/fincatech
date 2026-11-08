import { getProposalDetail } from '../../services/proposal-service'
import { requireRole } from '../../utils/rbac'

// El Invitado ve la propuesta y las cotizaciones, pero no participa en la votación (no se le
// devuelve su voto porque nunca puede tenerlo).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  return getProposalDetail(id, actor.role === 'guest' ? null : actor.id)
})
