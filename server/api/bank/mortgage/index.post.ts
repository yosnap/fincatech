import { z } from 'zod'
import { createScheduleEntry } from '../../../services/mortgage-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  chargeDay: z.number().int().min(1).max(31),
  effectiveFrom: z.string()
})

// Alta de un tramo («a partir de este mes, este importe y este día de cargo»).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return createScheduleEntry({ actorId: actor.id, ...parsed.data })
})
