import { previewBackfill } from '../../../../services/mortgage-service'
import { requireRole } from '../../../../utils/rbac'

// Vista previa del relleno: meses a crear, meses cuyo cargo está en la papelera (restaurar) y
// pagos manuales adoptables. Solo lee: no cambia nada hasta confirmar.
// `?until=AAAA-MM` limita el último mes (por defecto, el mes en curso).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])
  const until = getQuery(event).until
  return previewBackfill(new Date(), typeof until === 'string' && until ? until : undefined)
})
