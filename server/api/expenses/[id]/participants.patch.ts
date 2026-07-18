import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { users } from '../../../db/schema'
import { updateExpenseParticipants } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

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

  const participants = await db.select({ id: users.id, role: users.role, banned: users.banned })
    .from(users)
    .where(inArray(users.id, parsed.data.participantIds))
  const validIds = new Set(
    participants.filter(p => !p.banned && (p.role === 'admin' || p.role === 'owner')).map(p => p.id)
  )
  const invalidIds = parsed.data.participantIds.filter(pid => !validIds.has(pid))
  if (invalidIds.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Participantes inválidos: deben ser miembros activos (admin/owner)' })
  }

  const expense = await updateExpenseParticipants({
    expenseId: id,
    actorId: actor.id,
    participantIds: parsed.data.participantIds
  })

  return { expense }
})
