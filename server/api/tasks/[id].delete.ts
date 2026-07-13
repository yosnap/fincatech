import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { tasks } from '../../db/schema'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin, y solo desde la papelera (tarea ya descartada). Fotos
// asociadas se borran en cascada a nivel de FK. Todo en una transacción con lock de fila
// (mismo motivo que ideas/[id].delete.ts).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea' })
  }

  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update')
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
    }
    if (!task.discardedAt) {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una tarea descartada' })
    }

    await tx.delete(tasks).where(eq(tasks.id, id))

    await writeAuditLog({
      actorId: actor.id,
      action: 'task_deleted_permanently',
      entityType: 'task',
      entityId: id,
      metadata: { title: task.title }
    }, tx)
  })

  return { success: true }
})
