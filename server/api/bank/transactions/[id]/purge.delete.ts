import { purgeTransaction } from '../../../../services/bank-service'
import { requireRole } from '../../../../utils/rbac'

// Borrado definitivo de un movimiento EN LA PAPELERA (solo Admin, RT8-4): reutiliza el
// borrado duro de siempre — desvincula los aportes vivos y borra el justificante de MinIO.
// El 409 si la fila no está en la papelera lo pone el servicio, bajo FOR UPDATE.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  return purgeTransaction({ transactionId: id, actorId: actor.id })
})
