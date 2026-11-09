import { listProposals } from '../../services/proposal-service'
import { requireRole } from '../../utils/rbac'

// Las canceladas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  return { proposals: await listProposals() }
})
