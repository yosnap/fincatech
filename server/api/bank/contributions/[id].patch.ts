import { z } from 'zod'
import { isValidCalendarDate } from '../../../services/bank-core'
import {
  linkContribution,
  unlinkContribution,
  updateContribution
} from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({
  notes: z.string().nullable().optional(),
  date: z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida').optional(),
  // Vinculación con el ingreso bancario real: string = vincular, null = desvincular,
  // ausente = no tocar el vínculo (solo editar notas/fecha).
  bankTransactionId: z.string().uuid().nullable().optional()
})

// Edición de aporte, solo Admin: notas, fecha y vinculación/desvinculación del ingreso
// bancario. Importe, tipo, período y método no se editan (se borra y registra de nuevo).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de aporte' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  if (body.bankTransactionId !== undefined) {
    return body.bankTransactionId === null
      ? unlinkContribution({ contributionId: id, actorId: actor.id })
      : linkContribution({ contributionId: id, actorId: actor.id, bankTransactionId: body.bankTransactionId })
  }

  return updateContribution({
    contributionId: id,
    actorId: actor.id,
    notes: body.notes,
    date: body.date
  })
})
