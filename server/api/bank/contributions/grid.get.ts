import { getQuotaGrid } from '../../../services/contribution-service'
import { canSeeIndividualDebt, requireRole } from '../../../utils/rbac'

// Grid mensual de cuotas (miembro×mes con estado pagado/pendiente/adelantada). Desglose
// colectivo: oculto al Invitado (mismo criterio que canSeeIndividualDebt) — el Invitado
// solo ve y registra sus propias contribuciones.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  if (!canSeeIndividualDebt(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'El grid de cuotas no está disponible para tu rol' })
  }
  return getQuotaGrid()
})
