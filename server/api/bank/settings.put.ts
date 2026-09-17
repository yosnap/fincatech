import { z } from 'zod'
import { isValidCalendarDate } from '../../services/bank-core'
import { updateSettings } from '../../services/bank-service'
import { requireRole } from '../../utils/rbac'

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

const bodySchema = z.object({
  // null explícito = "aún sin configurar"; los tres campos van siempre en el PUT.
  purchaseDate: z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida').nullable(),
  quotaAmountCents: z.number().int().positive().max(100_000_000).nullable(),
  quotaStartMonth: z.string().regex(PERIOD_PATTERN).nullable()
})

// Escritura de la configuración financiera, solo Admin (el tesorero). Upsert de la fila
// única id='global' — crear la sección por primera vez no requiere paso previo.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return updateSettings({
    actorId: actor.id,
    purchaseDate: parsed.data.purchaseDate,
    quotaAmountCents: parsed.data.quotaAmountCents,
    quotaStartMonth: parsed.data.quotaStartMonth
  })
})
