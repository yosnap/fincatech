import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { proposals } from './governance'
import { users } from './users'

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  assigneeId: text('assignee_id').references(() => users.id),
  dueDate: timestamp('due_date', { withTimezone: true }),
  // 'low' | 'medium' | 'high' — validado en la capa de aplicación.
  priority: text('priority').notNull().default('medium'),
  // 'todo' | 'in_progress' | 'done' — validado en la capa de aplicación.
  status: text('status').notNull().default('todo'),
  // No nulo si la tarea nació de la ejecución de una propuesta aprobada (Fase 7).
  originProposalId: uuid('origin_proposal_id').references(() => proposals.id),
  // Descarte (soft-delete): separado del workflow todo/in_progress/done para no romper el
  // kanban. No nulo = tarea oculta del listado normal, visible solo en la papelera de Admin.
  discardedAt: timestamp('discarded_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  // Misma red de seguridad que expenses_origin_proposal_unique: una propuesta nunca genera
  // dos tareas de ejecución, ni siquiera si el guard de aplicación fallara.
  uniqueIndex('tasks_origin_proposal_unique').on(table.originProposalId).where(sql`${table.originProposalId} is not null`)
])
