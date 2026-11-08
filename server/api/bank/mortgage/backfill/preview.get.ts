import { previewBackfill } from '../../../../services/mortgage-service'
import { requireRole } from '../../../../utils/rbac'

// Vista previa del relleno: meses a crear, meses cuyo cargo está en la papelera (restaurar) y
// pagos manuales adoptables. Solo lee: no cambia nada hasta confirmar.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])
  return previewBackfill()
})
