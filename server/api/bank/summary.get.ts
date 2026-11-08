import { getBankSummary } from '../../services/bank-service'
import { requireRole } from '../../utils/rbac'

// Resumen de conciliación: saldo actual, saldo pre-compra, efectivo pendiente de depósito,
// ingresos sin origen y (solo Admin/Propietario) el fondo común por miembro. La lógica vive en
// server/services/bank-service.ts (getBankSummary) para que la herramienta `resumen_banco` del
// servidor MCP devuelva exactamente lo mismo.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  return getBankSummary(actor)
})
