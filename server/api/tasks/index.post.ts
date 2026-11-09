import { createTask, createTaskSchema } from '../../services/task-service'
import { requireRole } from '../../utils/rbac'

// Las tareas también se crean manualmente, no solo desde propuestas aprobadas (Fase 7).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const parsed = createTaskSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return { task: await createTask({ actor, ...parsed.data }) }
})
