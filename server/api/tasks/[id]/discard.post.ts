import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { tasks } from '../../../db/schema'
import { writeAuditLog } from '../../../utils/audit'
import { requireRole } from '../../../utils/rbac'

// Soft-delete: separado del status de workflow (todo/in_progress/done). Solo Admin o quien
// creó la tarea, mismo criterio que ideas (server/api/ideas/[id]/status.patch.ts).
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
  if (task.discardedAt) {
    throw createError({ statusCode: 400, statusMessage: 'La tarea ya está descartada' })
  }
  if (actor.role !== 'admin' && task.createdBy !== actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o quien creó la tarea pueden descartarla' })
  }

  const [updated] = await db.update(tasks)
    .set({ discardedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning()

  await writeAuditLog({
    actorId: actor.id,
    action: 'task_discarded',
    entityType: 'task',
    entityId: id
  })

  return { task: updated }
})
