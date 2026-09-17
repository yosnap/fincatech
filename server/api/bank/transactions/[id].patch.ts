import { z } from 'zod'
import { isValidCalendarDate } from '../../../services/bank-core'
import { updateTransaction } from '../../../services/bank-service'
import { requireRole } from '../../../utils/rbac'

const MAX_AMOUNT_CENTS = 100_000_000

const bodySchema = z.object({
  date: z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida'),
  direction: z.enum(['deposit', 'withdrawal']),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  description: z.string().min(1),
  // null = sin categoría. Solo depósitos: un aporte de miembro no lleva categoría.
  category: z.enum(['hacienda', 'ayuntamiento', 'impuestos', 'iva', 'otro']).nullable()
}).refine(body => body.direction === 'deposit' || body.category === null, {
  message: 'Las salidas no llevan categoría',
  path: ['category']
})

// Edición de movimiento bancario, solo Admin (el tesorero corrige errores de registro).
// El servicio impide romper la conciliación: movimientos con aportes vinculados deben
// seguir siendo ingresos sin categoría externa.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
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
