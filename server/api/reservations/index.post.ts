import { z } from 'zod'
import { createReservation } from '../../services/reservation-service'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  if (parsed.data.startDate > parsed.data.endDate) {
    throw createError({ statusCode: 400, statusMessage: 'La fecha de inicio debe ser anterior o igual a la de fin' })
  }

  const reservation = await createReservation({ ownerId: actor.id, ...parsed.data })
  return { reservation }
})
