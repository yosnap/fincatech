import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const telegramLinks = pgTable('telegram_links', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull().unique(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow()
})

// Token de un solo uso que el usuario envía al bot (/link TOKEN) para vincular su chat_id.
export const telegramLinkTokens = pgTable('telegram_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const notificationPreferences = pgTable('notification_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  telegramEnabled: boolean('telegram_enabled').notNull().default(false),
  emailEnabled: boolean('email_enabled').notNull().default(true)
})

export const notificationsOutbox = pgTable('notifications_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // 'telegram' | 'email' — validado en la capa de aplicación.
  channel: text('channel').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  // 'pending' | 'sent' | 'failed' — validado en la capa de aplicación.
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true })
})

// Dedupe de reintentos de Telegram (reenvía el mismo update_id si no respondemos a tiempo).
export const telegramProcessedUpdates = pgTable('telegram_processed_updates', {
  updateId: text('update_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
})
