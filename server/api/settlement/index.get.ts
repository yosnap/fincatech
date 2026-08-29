import { getSettlement } from '../../services/settlement-service'
import { requireRole } from '../../utils/rbac'

// Liquidación por persona (compensación de deudas cruzadas). No introduce restricciones
// de RBAC nuevas: las deudas propias son inherentemente datos del propio usuario, igual
// que en la Central de gastos; el desglose "cuánto ha gastado cada persona" sí queda
// oculto al Invitado dentro del servicio.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  return getSettlement(actor)
})
