import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { users } from './users'

// Repositorio de medios compartido: fotos de tareas (antes/después) y, en la Fase 8,
// la galería general del inmueble (taskId nulo = foto de galería, no ligada a una tarea).
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectName: text('object_name').notNull(),
  contentType: text('content_type').notNull(),
  // 'before' | 'after' | 'general' — validado en la capa de aplicación.
  type: text('type').notNull().default('general'),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
