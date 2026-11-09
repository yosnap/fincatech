import { purgeExpense } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

// Borrado definitivo de un gasto EN LA PAPELERA (solo Admin, RT8-4): deudas en cascada,
// comprobantes y objetos de MinIO. El 409 si el gasto no está en la papelera lo pone el
// servicio, bajo FOR UPDATE.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  return purgeExpense({ expenseId: id, actorId: actor.id, actorRole: actor.role })
})
