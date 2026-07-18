import { deleteExpense } from '../../services/expense-service'
import { requireRole } from '../../utils/rbac'

// Solo Admin elimina gastos (decisión de producto): borrado duro, bloqueado si alguna
// cuota ya tiene rastro de pago (ver deleteExpense en expense-service.ts).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  await deleteExpense({ expenseId: id, actorId: actor.id })
  return { success: true }
})
