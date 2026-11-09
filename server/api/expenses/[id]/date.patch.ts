import { z } from 'zod'
import { isValidCalendarDate } from '../../../services/bank-core'
import { updateExpenseDate } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({
  // Fecha del gasto ('YYYY-MM-DD'): cuándo se pagó, no cuándo se registró.
  date: z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida')
})

// Cambiar la fecha de un gasto, solo Admin (fase 3). El servicio rechaza fechas futuras y
// gastos en la papelera, y deja rastro en el audit log.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const expense = await updateExpenseDate({ expenseId: id, actorId: actor.id, expenseDate: parsed.data.date })
  return { expense }
})
