import { listIdeas } from '../../services/idea-service'
import { requireRole } from '../../utils/rbac'

// Las descartadas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera. La lógica vive en server/services/idea-service.ts.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  return { ideas: await listIdeas() }
})
