import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { reservations } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'
import { getUserNameMap } from '../utils/user-names'

interface CreateReservationInput {
  ownerId: string
  startDate: string
  endDate: string
  notes?: string
}

// El solape se rechaza a nivel de PostgreSQL (constraint EXCLUDE USING gist, ver migración
// 0008) — este catch traduce el error de exclusion_violation (23P01) en un 409 legible.
export async function createReservation(input: CreateReservationInput) {
  try {
    const [reservation] = await db.insert(reservations).values({
      ownerId: input.ownerId,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes ?? null
    }).returning()
    if (!reservation) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la reserva' })
    }

    await writeAuditLog({
      actorId: input.ownerId,
      action: 'reservation_created',
      entityType: 'reservation',
      entityId: reservation.id,
      metadata: { startDate: input.startDate, endDate: input.endDate }
    })

    return reservation
  } catch (error) {
    if (getPgErrorCode(error) === '23P01') {
      throw createError({ statusCode: 409, statusMessage: 'Las fechas seleccionadas se solapan con otra reserva' })
    }
    throw error
  }
}

interface DeleteReservationInput {
  reservationId: string
  actorId: string
  actorRole: string
}

// Cancelar una reserva: solo su dueño o el Admin. El borrado es duro (la reserva no guarda
// documentos ni dinero) y queda auditado.
export async function deleteReservation(input: DeleteReservationInput) {
  const reservation = await db.query.reservations.findFirst({ where: eq(reservations.id, input.reservationId) })
  if (!reservation) {
    throw createError({ statusCode: 404, statusMessage: 'Reserva no encontrada' })
  }
  if (input.actorRole !== 'admin' && reservation.ownerId !== input.actorId) {
    throw createError({ statusCode: 403, statusMessage: 'Solo puedes cancelar tus propias reservas' })
  }

  await db.delete(reservations).where(eq(reservations.id, input.reservationId))
  await writeAuditLog({
    actorId: input.actorId,
    action: 'reservation_cancelled',
    entityType: 'reservation',
    entityId: input.reservationId,
    metadata: { startDate: reservation.startDate, endDate: reservation.endDate, ownerId: reservation.ownerId }
  })

  return { success: true as const }
}

// Listado con el nombre del dueño ya resuelto (la vista de calendario y la leyenda de personas
// lo necesitan, y el calendario también lo ven Invitados, sin acceso a /api/members).
export async function listReservationsWithOwnerNames() {
  const rows = await db.query.reservations.findMany({ orderBy: (r, { asc }) => [asc(r.startDate)] })
  const nameMap = await getUserNameMap(rows.map(r => r.ownerId))
  return rows.map(r => ({ ...r, ownerName: nameMap.get(r.ownerId) ?? r.ownerId }))
}
