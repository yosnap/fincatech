import { deleteTransaction } from '../../../services/bank-service'
import { requireRole } from '../../../utils/rbac'

// Borrado duro, solo Admin (decisión de producto — patrón expenses). El servicio
// desvincula los aportes que referencian el movimiento antes de borrarlo.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  return deleteTransaction({ transactionId: id, actorId: actor.id })
})
