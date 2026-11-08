import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// Tramos de la hipoteca: cada fila es «a partir de este mes, el cargo es este importe y
// cae este día». El importe de un mes es el del tramo con mayor `effectiveFrom <= mes`, así
// que cambiar el importe desde diciembre no reescribe septiembre a noviembre. El día de cargo
// se recorta al último día del mes cuando el mes es más corto (mortgage-core.ts).
export const mortgageSchedule = pgTable('mortgage_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  amountCents: integer('amount_cents').notNull(),
  // 1-31, validado en la capa de aplicación.
  chargeDay: integer('charge_day').notNull(),
  // 'YYYY-MM' desde el que aplica este tramo.
  effectiveFrom: text('effective_from').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  // Un único tramo por mes de inicio: dos tramos con el mismo `effectiveFrom` harían
  // ambiguo el importe vigente.
  uniqueIndex('mortgage_schedule_effective_from_unique').on(table.effectiveFrom)
])
