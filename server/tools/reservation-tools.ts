import { z } from 'zod'
import { createReservation, deleteReservation, listReservationsWithOwnerNames } from '../services/reservation-service'
import { calendarDateSchema } from '../validation/finance'
import { defineTool } from './types'

// Herramientas de reservas (fase 4): listar, crear y cancelar.

export const reservationTools = [
  defineTool({
    name: 'listar_reservas',
    description: 'Lista las reservas de la finca (quién y qué fechas) ordenadas por fecha de inicio.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const reservations = await listReservationsWithOwnerNames()
      return {
        reservas: reservations.map(reservation => ({
          id: reservation.id,
          persona: reservation.ownerName,
          desde: reservation.startDate,
          hasta: reservation.endDate,
          notas: reservation.notes
        }))
      }
    }
  }),

  defineTool({
    name: 'crear_reserva',
    description: 'Reserva la finca para el usuario actual entre dos fechas. Si se solapa con otra reserva devuelve conflicto.',
    kind: 'write',
    inputSchema: z.object({
      desde: calendarDateSchema,
      hasta: calendarDateSchema,
      notas: z.string().max(500).optional()
    }),
    handler: async (actor, input) => {
      if (input.desde > input.hasta) {
        throw createError({ statusCode: 400, statusMessage: 'La fecha de inicio debe ser anterior o igual a la de fin' })
      }
      const reservation = await createReservation({
        ownerId: actor.id,
        startDate: input.desde,
        endDate: input.hasta,
        notes: input.notas
      })
      return { reservaId: reservation.id, desde: reservation.startDate, hasta: reservation.endDate }
    }
  }),

  defineTool({
    name: 'eliminar_reserva',
    description: 'Cancela una reserva. Solo el Admin o su dueño.',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => deleteReservation({
      reservationId: input.id,
      actorId: actor.id,
      actorRole: actor.role
    })
  })
]
