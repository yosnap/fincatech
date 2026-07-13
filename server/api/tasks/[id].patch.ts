import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { tasks } from '../../db/schema'
import { enqueueNotification } from '../../services/notification-service'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional()
})

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner'])
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
  const body = parsed.data

  const [updated] = await db.update(tasks).set({
    ...(body.title !== undefined && { title: body.title }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
    ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
    ...(body.priority !== undefined && { priority: body.priority }),
    updatedAt: new Date()
  }).where(eq(tasks.id, id)).returning()
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo actualizar la tarea' })
  }

  if (body.assigneeId !== undefined && body.assigneeId && body.assigneeId !== task.assigneeId) {
    await enqueueNotification({
      userId: body.assigneeId,
      eventType: 'task_assigned',
      subject: 'Tarea asignada',
      body: `Se te ha asignado la tarea "${updated.title}".`
    })
  }

  return { task: updated }
})
