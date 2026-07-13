import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { reservations } from '../../db/schema'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de reserva' })
  }

  const reservation = await db.query.reservations.findFirst({ where: eq(reservations.id, id) })
  if (!reservation) {
    throw createError({ statusCode: 404, statusMessage: 'Reserva no encontrada' })
  }
  if (actor.role !== 'admin' && reservation.ownerId !== actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo puedes cancelar tus propias reservas' })
  }

  await db.delete(reservations).where(eq(reservations.id, id))
  await writeAuditLog({
    actorId: actor.id,
    action: 'reservation_cancelled',
    entityType: 'reservation',
    entityId: id,
    metadata: { startDate: reservation.startDate, endDate: reservation.endDate, ownerId: reservation.ownerId }
  })

  return { success: true }
})
