import { z } from 'zod'
import { confirmBackfill } from '../../../../services/mortgage-service'
import { requireRole } from '../../../../utils/rbac'

const bodySchema = z.object({
  // Pagos manuales que pasan a ser el cargo automático de su mes (conservan justificante).
  adoptTransactionIds: z.array(z.string().uuid()).default([]),
  // Último mes a rellenar (incluido); por defecto, el mes en curso.
  until: z.string().optional()
})

// Confirmación del relleno en UNA transacción: adoptar los pagos elegidos + crear los meses
// que falten. Nunca modifica cargos existentes.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const parsed = bodySchema.safeParse((await readBody(event).catch(() => ({}))) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return confirmBackfill({ actorId: actor.id, adoptTransactionIds: parsed.data.adoptTransactionIds, until: parsed.data.until })
})
