import { z } from 'zod'
import { updateExpenseParticipants } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'
import { assertEligibleParticipants } from '../../../validation/participants'

const bodySchema = z.object({
  participantIds: z.array(z.string().min(1)).min(1)
})

// Solo Admin corrige el reparto de un gasto ya creado (p. ej. tickets antiguos a los que
// no se marcó a todos los propietarios) — bloqueado si ya hay pagos, ver expense-service.ts.
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

  await assertEligibleParticipants(parsed.data.participantIds)

  const expense = await updateExpenseParticipants({
    expenseId: id,
    actorId: actor.id,
    participantIds: parsed.data.participantIds
  })

  return { expense }
})
