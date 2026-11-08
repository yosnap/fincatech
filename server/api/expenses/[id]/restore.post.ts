import { restoreExpense } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

// Restaurar un gasto desde la papelera (solo Admin). 409 si algún participante está de baja.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  return restoreExpense({ expenseId: id, actorId: actor.id })
})
