import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  // 'admin' | 'owner' | 'guest' — validado en la capa de aplicación.
  role: text('role').notNull(),
  token: text('token').notNull().unique(),
  invitedBy: text('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  // Admin cancela una invitación antes de que se acepte (server/api/members/invitations/[id]/cancel.post.ts).
  // Se mantiene la fila (no se borra) para conservar el historial, igual que usedAt.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
