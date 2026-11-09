import { getMortgageOverview } from '../../../services/mortgage-service'
import { requireRole } from '../../../utils/rbac'

// Configuración de la hipoteca y cargos automáticos existentes (solo Admin = tesorero).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])
  return getMortgageOverview()
})
