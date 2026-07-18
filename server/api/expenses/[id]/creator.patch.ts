import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { users } from '../../../db/schema'
import { reassignExpenseCreator } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({
  userId: z.string().min(1)
})

// Solo Admin corrige quién figura como pagador de un gasto (p. ej. ticket asignado a la
// persona equivocada) — bloqueado si ya hay pagos, ver expense-service.ts.
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

  const [newCreator] = await db.select({ id: users.id, role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
  if (!newCreator || newCreator.banned || (newCreator.role !== 'admin' && newCreator.role !== 'owner')) {
    throw createError({ statusCode: 400, statusMessage: 'El nuevo pagador debe ser un miembro activo (admin/propietario)' })
  }

  const expense = await reassignExpenseCreator({
    expenseId: id,
    actorId: actor.id,
    newCreatedBy: parsed.data.userId
  })

  return { expense }
})
