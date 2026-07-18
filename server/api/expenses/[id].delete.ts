import { deleteExpense } from '../../services/expense-service'
import { requireRole } from '../../utils/rbac'

// Admin elimina cualquier gasto; Propietario solo los que él mismo dio de alta (ver
// deleteExpense en expense-service.ts). Borrado duro, bloqueado si alguna cuota ya tiene
// rastro de pago.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  await deleteExpense({ expenseId: id, actorId: actor.id, actorRole: actor.role })
  return { success: true }
})
