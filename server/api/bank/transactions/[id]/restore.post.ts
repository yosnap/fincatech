import { restoreTransaction } from '../../../../services/bank-service'
import { requireRole } from '../../../../utils/rbac'

// Restaurar un movimiento desde la papelera (solo Admin). Idempotente: si ya estaba vivo,
// devuelve la fila sin tocar nada.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  return restoreTransaction({ transactionId: id, actorId: actor.id })
})
