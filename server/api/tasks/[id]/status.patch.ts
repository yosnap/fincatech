import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { tasks } from '../../../db/schema'
import { writeAuditLog } from '../../../utils/audit'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({ status: z.enum(['todo', 'in_progress', 'done']) })

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea' })
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const updated = await db.transaction(async (tx) => {
    const [updated] = await tx.update(tasks)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()

    await writeAuditLog({
      actorId: actor.id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: id,
      metadata: { status: parsed.data.status }
    }, tx)

    return updated
  })

  return { task: updated }
})
