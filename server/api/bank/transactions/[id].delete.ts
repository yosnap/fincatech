import { trashTransaction } from '../../../services/bank-service'
import { requireRole } from '../../../utils/rbac'

// Papelera (fase 8), solo Admin: el movimiento deja de contar en saldo, conciliación y fondo
// común, pero se conserva con su justificante y se puede restaurar desde /admin/trash.
// Los aportes vinculados NO se desvinculan: con el movimiento en la papelera, las lecturas
// los tratan como no depositados hasta que se restaure.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  return trashTransaction({ transactionId: id, actorId: actor.id })
})
