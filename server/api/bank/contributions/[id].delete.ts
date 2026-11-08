import { trashContribution } from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'

// Papelera (fase 8): el autor del registro o el Admin (regla del servicio, patrón expenses).
// Si es una transferencia con su ingreso espejo y quien lo hace es el Admin, el movimiento se
// mueve también a la papelera en la misma transacción (RT8-3); si es un Propietario, el
// ingreso queda vivo y el resumen avisa de «ingreso sin aporte asociado».
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de aporte' })
  }

  return trashContribution({ contributionId: id, actorId: actor.id, actorRole: actor.role })
})
