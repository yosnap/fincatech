import { discardTask } from '../../../services/task-service'
import { requireRole } from '../../../utils/rbac'

// Soft-delete: separado del status de workflow. Solo Admin o quien creó la tarea.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea' })
  }

  return { task: await discardTask({ actor, taskId: id }) }
})
