import { updateTransaction } from '../../../services/bank-service'
import { requireRole } from '../../../utils/rbac'
import { bankTransactionFieldsSchema } from '../../../validation/finance'

// Edición de movimiento bancario, solo Admin (el tesorero corrige errores de registro).
// El servicio impide romper la conciliación: movimientos con aportes vinculados deben
// seguir siendo ingresos sin categoría externa.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  const parsed = bankTransactionFieldsSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return updateTransaction({
    transactionId: id,
    actorId: actor.id,
    date: parsed.data.date,
    direction: parsed.data.direction,
    amountCents: parsed.data.amountCents,
    description: parsed.data.description,
    category: parsed.data.category
  })
})
