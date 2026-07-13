import { db } from '../db/client'
import { reservations } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'

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
