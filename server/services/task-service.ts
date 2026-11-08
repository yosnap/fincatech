import { desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { media, tasks } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { resolveMediaUrls } from '../utils/media-urls'
import type { SessionUser } from '../utils/rbac'
import { enqueueNotification } from './notification-service'

// Servicio de tareas (fase 4, RT-4): la lógica vivía en los handlers de `server/api/tasks/*`
// y el servidor MCP / bot de Telegram la necesitan igual. Los endpoints ahora son envoltorios
// finos sobre estas funciones — mismo comportamiento, una sola implementación.

export const TASK_STATUS_VALUES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITY_VALUES = ['low', 'medium', 'high'] as const

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  // 'YYYY-MM-DD'
  dueDate: z.string().optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).default('medium')
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional()
})

export const taskStatusSchema = z.object({ status: z.enum(TASK_STATUS_VALUES) })

// Las tareas descartadas quedan ocultas del listado normal — solo visibles en la papelera.
export async function listTasks() {
  return db.query.tasks.findMany({ where: isNull(tasks.discardedAt), orderBy: [desc(tasks.createdAt)] })
}

export async function getTaskWithMedia(taskId: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }
  const taskMedia = await db.query.media.findMany({ where: eq(media.taskId, taskId) })
  return { task, media: await resolveMediaUrls(taskMedia) }
}

interface CreateTaskInput {
  actor: SessionUser
  title: string
  description?: string
  assigneeId?: string
  dueDate?: string
  priority?: (typeof TASK_PRIORITY_VALUES)[number]
}

export async function createTask(input: CreateTaskInput) {
  const [task] = await db.insert(tasks).values({
    title: input.title,
    description: input.description ?? null,
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    priority: input.priority ?? 'medium',
    createdBy: input.actor.id
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

  return task
}

interface UpdateTaskInput {
  actor: SessionUser
  taskId: string
  title?: string
  description?: string | null
  assigneeId?: string | null
  dueDate?: string | null
  priority?: (typeof TASK_PRIORITY_VALUES)[number]
}

export async function updateTask(input: UpdateTaskInput) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }
  if (task.discardedAt) {
    throw createError({ statusCode: 409, statusMessage: 'La tarea está descartada y no admite cambios' })
  }

  const [updated] = await db.update(tasks).set({
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate ? new Date(input.dueDate) : null }),
    ...(input.priority !== undefined && { priority: input.priority }),
    updatedAt: new Date()
  }).where(eq(tasks.id, input.taskId)).returning()
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo actualizar la tarea' })
  }

  if (input.assigneeId !== undefined && input.assigneeId && input.assigneeId !== task.assigneeId) {
    await enqueueNotification({
      userId: input.assigneeId,
      eventType: 'task_assigned',
      subject: 'Tarea asignada',
      body: `Se te ha asignado la tarea "${updated.title}".`
    })
  }

  return updated
}

export async function changeTaskStatus(input: {
  actor: SessionUser
  taskId: string
  status: (typeof TASK_STATUS_VALUES)[number]
}) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }
  if (task.discardedAt) {
    throw createError({ statusCode: 400, statusMessage: 'Esta tarea está descartada y no admite cambios de estado' })
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(tasks)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(tasks.id, input.taskId))
      .returning()

    await writeAuditLog({
      actorId: input.actor.id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: input.taskId,
      metadata: { status: input.status }
    }, tx)

    return updated!
  })
}

// Soft-delete: separado del status de workflow (todo/in_progress/done). Solo Admin o quien
// creó la tarea, mismo criterio que ideas.
export async function discardTask(input: { actor: SessionUser, taskId: string }) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }
  if (task.discardedAt) {
    throw createError({ statusCode: 400, statusMessage: 'La tarea ya está descartada' })
  }
  if (input.actor.role !== 'admin' && task.createdBy !== input.actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o quien creó la tarea pueden descartarla' })
  }

  const [updated] = await db.update(tasks)
    .set({ discardedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, input.taskId))
    .returning()

  await writeAuditLog({
    actorId: input.actor.id,
    action: 'task_discarded',
    entityType: 'task',
    entityId: input.taskId
  })

  return updated!
}

// Borrado definitivo: solo Admin, y solo desde la papelera (tarea ya descartada).
export async function deleteTaskPermanently(input: { actor: SessionUser, taskId: string }) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId)).for('update')
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
    }
    if (!task.discardedAt) {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una tarea descartada' })
    }

    await tx.delete(tasks).where(eq(tasks.id, input.taskId))

    await writeAuditLog({
      actorId: input.actor.id,
      action: 'task_deleted_permanently',
      entityType: 'task',
      entityId: input.taskId,
      metadata: { title: task.title }
    }, tx)

    return { success: true as const }
  })
}
