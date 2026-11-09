import { trashExpense } from '../../services/expense-service'
import { requireRole } from '../../utils/rbac'

// Papelera (fase 8): Admin mueve cualquier gasto; Propietario solo los que él mismo dio de
// alta (ver trashExpense en expense-service.ts). Se bloquea si alguna cuota ya tiene rastro
// de pago, igual que el borrado de antes.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  return trashExpense({ expenseId: id, actorId: actor.id, actorRole: actor.role })
})
