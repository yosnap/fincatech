import { listPossibleDuplicates } from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'

// Posibles aportes duplicados (mismo miembro, importe, tipo, fecha y período), solo Admin:
// es quien puede eliminar el sobrante.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])
  return { groups: await listPossibleDuplicates() }
})
