import { deleteReservation } from '../../services/reservation-service'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de reserva' })
  }

  return deleteReservation({ reservationId: id, actorId: actor.id, actorRole: actor.role })
})
