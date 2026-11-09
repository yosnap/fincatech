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
  bankTransactionId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  type: z.enum(['pre_purchase', 'quota', 'extraordinary']).optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional()
})

// Edición de aporte, solo Admin: notas, fecha, importe, tipo, período y vinculación /
// desvinculación del ingreso bancario. El método no se edita.
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
    date: body.date,
    amountCents: body.amountCents,
    type: body.type,
    period: body.period
  })
})
