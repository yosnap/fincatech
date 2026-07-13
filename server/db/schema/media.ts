import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { ideas, proposals } from './governance'
import { tasks } from './tasks'
import { users } from './users'

// Repositorio de medios compartido y polimórfico: fotos de tareas (antes/después), galería
// general del inmueble (todas las FK nulas), e ideas/propuestas (galería de referencia).
// Como máximo una de taskId/ideaId/proposalId es no-nula por fila — no se valida a nivel
// de esquema (Drizzle no expone un CHECK de "exactamente una"), se garantiza en la capa
// de aplicación (cada endpoint de subida solo rellena la suya).
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectName: text('object_name').notNull(),
  contentType: text('content_type').notNull(),
  // 'before' | 'after' | 'general' — validado en la capa de aplicación.
  type: text('type').notNull().default('general'),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'cascade' }),
  proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
