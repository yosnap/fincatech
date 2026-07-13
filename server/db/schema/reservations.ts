import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// La prevención de solapes se aplica a nivel de PostgreSQL con un EXCLUDE USING gist sobre
// daterange(start_date, end_date, '[]') — Drizzle no expone un builder para EXCLUDE
// constraints, así que se añade a mano en la migración generada, no está representado aquí.
// Rango inclusivo-inclusivo deliberado (permite reservar un único día); trade-off aceptado:
// dos reservas no pueden encadenar checkout/checkin el mismo día.
export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
