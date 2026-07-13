import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// Enlaces de referencia (TikTok, Facebook, imágenes, lo que sea) para ideas, propuestas y
// tareas. Polimórfica por entityType+entityId sin FK real cruzada (mismo patrón que
// proposals.winningQuoteId) — se valida en la capa de aplicación.
export const referenceLinks = pgTable('reference_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 'idea' | 'proposal' | 'task' — validado en la capa de aplicación.
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  url: text('url').notNull(),
  label: text('label'),
  addedBy: text('added_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
