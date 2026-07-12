import { confirmDebtReceipt } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

// Admin o el acreedor original pueden confirmar (autorización fina dentro del servicio).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const debtId = getRouterParam(event, 'id')
  if (!debtId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de cuota' })
  }

  const debt = await confirmDebtReceipt({ debtId, actorId: actor.id, actorRole: actor.role })
  return { debt }
})
