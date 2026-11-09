import { listTasks } from '../../services/task-service'
import { requireRole } from '../../utils/rbac'

// Las tareas descartadas quedan ocultas del listado normal — solo visibles en la papelera
// de Admin (GET /api/admin/trash). La lógica vive en server/services/task-service.ts.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  return { tasks: await listTasks() }
})
