import { getSettings } from '../../services/bank-service'
import { requireRole } from '../../utils/rbac'

// Configuración financiera global (fecha de compra, cuota, mes de inicio): lectura para
// cualquier autenticado — delimita períodos que toda la UI de finanzas muestra.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  return getSettings()
})
