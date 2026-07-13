import { z } from 'zod'
import { db } from '../../db/client'
import { tasks } from '../../db/schema'
import { enqueueNotification } from '../../services/notification-service'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium')
})

// Las tareas también se crean manualmente, no solo desde propuestas aprobadas (Fase 7).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  const [task] = await db.insert(tasks).values({
    title: body.title,
    description: body.description ?? null,
    assigneeId: body.assigneeId ?? null,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    priority: body.priority,
    createdBy: actor.id
  }).returning()
  if (!task) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la tarea' })
  }

  if (task.assigneeId) {
    await enqueueNotification({
      userId: task.assigneeId,
      eventType: 'task_assigned',
      subject: 'Tarea asignada',
      body: `Se te ha asignado la tarea "${task.title}".`
    })
  }

  return { task }
})
