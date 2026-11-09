import { z } from 'zod'
import { updateScheduleEntry } from '../../../services/mortgage-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  chargeDay: z.number().int().min(1).max(31),
  effectiveFrom: z.string()
})

// Editar un tramo no reescribe los cargos ya creados (RT-10).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tramo' })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return updateScheduleEntry({ entryId: id, actorId: actor.id, ...parsed.data })
})
