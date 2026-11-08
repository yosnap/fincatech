import { deleteProposalPermanently } from '../../services/proposal-service'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin. Las reglas (derrama sin pagos, tarea de ejecución, enlaces)
// viven en server/services/proposal-service.ts.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  return deleteProposalPermanently({ proposalId: id, actorId: actor.id })
})
