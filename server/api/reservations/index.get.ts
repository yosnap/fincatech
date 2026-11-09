import { listReservationsWithOwnerNames } from '../../services/reservation-service'
import { requireRole } from '../../utils/rbac'

// ownerName ya resuelto server-side (mismo patrón que ideas/propuestas): la vista de
// calendario y la leyenda de personas lo necesitan, y el calendario también lo ven
// Invitados, que no tienen acceso a endpoints de miembros.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  return { reservations: await listReservationsWithOwnerNames() }
})
